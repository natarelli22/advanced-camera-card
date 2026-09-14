import { add, differenceInSeconds, sub } from 'date-fns';
import type { LitElement } from 'lit';
import { isEqual, throttle } from 'lodash-es';
import type { ViewContext } from 'view';
import {
  Timeline,
  type IdType,
  type TimelineEventPropertiesResult,
  type TimelineFormatOption,
  type TimelineItem,
  type TimelineOptions,
  type TimelineOptionsCluster,
  type TimelineWindow,
} from 'vis-timeline';

import type { CameraManager } from '../../camera-manager/manager';
import { rangesOverlap } from '../../camera-manager/range';
import { convertRangeToCacheFriendlyTimes } from '../../camera-manager/utils/range-to-cache-friendly';
import type { FoldersManager } from '../../card-controller/folders/manager';
import type { ViewItemManager } from '../../card-controller/view/item-manager';
import { MergeContextViewModifier } from '../../card-controller/view/modifiers/merge-context';
import { RemoveContextViewModifier } from '../../card-controller/view/modifiers/remove-context';
import { RemoveContextPropertyViewModifier } from '../../card-controller/view/modifiers/remove-context-property';
import type { ViewManagerEpoch } from '../../card-controller/view/types';
import type { ConditionStateManagerReadonlyInterface } from '../../condition-trigger/conditions/types';
import type { CameraConfig } from '../../config/schema/cameras';
import type { AdvancedCameraCardView } from '../../config/schema/common/const';
import type { ThumbnailsControlBaseConfig } from '../../config/schema/common/controls/thumbnails';
import {
  timelineCoreConfigDefault,
  type TimelineCoreComponentConfig,
  type TimelinePanMode,
} from '../../config/schema/common/controls/timeline';
import type { HomeAssistant } from '../../ha/types';
import { getLanguage } from '../../localize/localize.js';
import { stopEventFromActivatingCardWideActions } from '../../utils/action';
import { formatDateAndTime, isHoverableDevice, isTruthy } from '../../utils/basic';
import { findBestMediaTimeIndex } from '../../utils/find-best-media-time-index';
import { fireAdvancedCameraCardEvent } from '../../utils/fire-advanced-camera-card-event';
import type { ViewMedia } from '../../view/item';
import { ViewItemClassifier } from '../../view/item-classifier';
import { QueryResults } from '../../view/query-results';
import type { UnifiedQuery } from '../../view/unified-query';
import { UnifiedQueryTransformer } from '../../view/unified-query-transformer';
import { mergeViewContext } from '../../view/view';
import { getTimelineLocale, setMomentLocale, TIMELINE_LOCALES } from './locales.js';
import {
  canMediaBeShownAsTimelineItem,
  TimelineDataSource,
  type AdvancedCameraCardTimelineItem,
} from './source';
import type {
  ExtendedTimeline,
  TimelineItemClickAction,
  TimelineRangeChange,
} from './types';

// An event used to fetch data required for thumbnail rendering. See special
// note below on why this is necessary.
interface ThumbnailDataRequest {
  item: IdType;
  hass?: HomeAssistant;
  cameraManager?: CameraManager;
  cameraConfig?: CameraConfig;
  media?: ViewMedia;
  viewManagerEpoch?: ViewManagerEpoch;
  viewItemManager?: ViewItemManager;
}

class ThumbnailDataRequestEvent extends CustomEvent<ThumbnailDataRequest> {}

interface TimelineControllerOptions {
  hass?: HomeAssistant;
  cameraManager?: CameraManager;
  conditionStateManager?: ConditionStateManagerReadonlyInterface;
  foldersManager?: FoldersManager;
  viewItemManager?: ViewItemManager;
  timelineConfig?: TimelineCoreComponentConfig;
  mini?: boolean;
  thumbnailConfig?: ThumbnailsControlBaseConfig;
  query?: UnifiedQuery;
}

const TIMELINE_TARGET_BAR_ID = 'target_bar';

export class TimelineController {
  private _host: LitElement;
  private _timelineElement: HTMLElement | null = null;

  private _source: TimelineDataSource | null = null;
  private _timeline: ExtendedTimeline | null = null;

  private _hass: HomeAssistant | null = null;

  private _cameraManager: CameraManager | null = null;
  private _foldersManager: FoldersManager | null = null;

  private _viewItemManager: ViewItemManager | null = null;
  private _viewManagerEpoch: ViewManagerEpoch | null = null;
  private _timelineConfig: TimelineCoreComponentConfig | null = null;

  private _mini = false;

  private _panMode: TimelinePanMode | null = null;
  private _targetBarVisible = false;
  private _itemClickAction: TimelineItemClickAction = 'play';

  private _thumbnailConfig: ThumbnailsControlBaseConfig | null = null;

  private readonly _isHoverableDevice = isHoverableDevice();

  // Range changes are volumonous: throttle the calls on seeking.
  private _throttledSetViewDuringRangeChange = throttle(
    this._setViewDuringRangeChange.bind(this),
    1000 / 10,
  );

  // Need a way to separate when a user clicks (to pan the timeline) vs when a
  // user clicks (to choose a recording (non-event) to play).
  private _pointerHeld:
    | (TimelineEventPropertiesResult & { window?: TimelineWindow })
    | null = null;
  private _ignoreClick = false;

  constructor(host: LitElement) {
    this._host = host;
  }

  public setHass(hass: HomeAssistant | null): void {
    this._hass = hass;
  }

  public destroyTimeline(): void {
    this._timeline?.destroy();
    this._timeline = null;
    this._targetBarVisible = false;
    this._pointerHeld = null;
    this._viewManagerEpoch = null;
  }

  /**
   * Extract the "shape" of a query - a clone without time ranges.
   * Shape determines timeline structure (groups).
   */
  private _getQueryShape(query: UnifiedQuery): UnifiedQuery {
    return UnifiedQueryTransformer.stripLimits(
      UnifiedQueryTransformer.stripTimeRange(query),
    );
  }

  private _hasSameShape(a?: UnifiedQuery | null, b?: UnifiedQuery | null): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return a.isEqual(b);
  }

  public setOptions(options: TimelineControllerOptions): void {
    // Extract the shape (query without time ranges) for comparison.
    // - options.query === undefined means "caller did not supply a query" (e.g.
    //   the current view has query: null after navigateMedia). In that case keep
    //   the existing shape so the timeline is NOT needlessly destroyed and rebuilt.
    // - options.query !== undefined (including null) means an explicit override.
    const newShape =
      options.query !== undefined
        ? options.query
          ? this._getQueryShape(options.query)
          : null
        : this._source?.shape ?? null;

    // Rebuild source if config, dependencies, or shape changed.
    const needsRebuild =
      !this._source ||
      this._cameraManager !== (options.cameraManager ?? null) ||
      this._foldersManager !== (options.foldersManager ?? null) ||
      !isEqual(this._timelineConfig, options.timelineConfig ?? null) ||
      !this._hasSameShape(this._source?.shape, newShape);

    if (needsRebuild) {
      this.destroyTimeline();

      if (
        newShape &&
        options.cameraManager &&
        options.foldersManager &&
        options.conditionStateManager &&
        options.timelineConfig
      ) {
        this._source = new TimelineDataSource(
          options.cameraManager,
          options.foldersManager,
          options.conditionStateManager,
          newShape,
          options.timelineConfig.show_recordings,
          options.timelineConfig.chunk_hours,
        );
      } else {
        this._source = null;
      }
    }

    if (this._thumbnailConfig !== (options.thumbnailConfig ?? null)) {
      if (options.thumbnailConfig) {
        this._host.style.setProperty(
          '--advanced-camera-card-thumbnail-size',
          `${options?.thumbnailConfig.size}px`,
        );
      } else {
        this._host.style.removeProperty('--advanced-camera-card-thumbnail-size');
      }
    }

    if (this._timelineConfig !== (options.timelineConfig ?? null)) {
      this._timelineConfig = options?.timelineConfig ?? null;

      this._source?.setChunkHours(this._timelineConfig?.chunk_hours);
      this._host.toggleAttribute('recordings', !!this._timelineConfig?.show_recordings);
      this._host.toggleAttribute('ribbon', this._timelineConfig?.style === 'ribbon');
      this._host.toggleAttribute('stack', this._timelineConfig?.style === 'stack');
    }

    this._thumbnailConfig = options?.thumbnailConfig ?? null;
    this._cameraManager = options?.cameraManager ?? null;
    this._foldersManager = options?.foldersManager ?? null;
    this._viewItemManager = options?.viewItemManager ?? null;
    this._timelineConfig = options?.timelineConfig ?? null;
    this._mini = options?.mini ?? false;

    this._host.toggleAttribute('groups', this._shouldShowGroups());
  }

  public async setView(
    viewManagerEpoch: ViewManagerEpoch | null,
    force = false,
  ): Promise<void> {
    if (!force && this._viewManagerEpoch === viewManagerEpoch) {
      return;
    }

    this._viewManagerEpoch = viewManagerEpoch ?? null;
    await this._updateTimelineFromView();
  }

  public handleThumbnailDataRequest = (request: ThumbnailDataRequestEvent): void => {
    const itemID = request.detail.item;
    const media = this._source?.dataset.get(itemID)?.media;
    const cameraConfig = media
      ? this._cameraManager?.getStore().getCameraConfigForMedia(media) ?? undefined
      : undefined;

    request.detail.hass = this._hass ?? undefined;
    request.detail.cameraConfig = cameraConfig;
    request.detail.cameraManager = this._cameraManager ?? undefined;
    request.detail.viewItemManager = this._viewItemManager ?? undefined;
    request.detail.media = media;
    request.detail.viewManagerEpoch = this._viewManagerEpoch ?? undefined;
  };

  public getEffectivePanMode(): TimelinePanMode {
    return this._panMode ?? this._timelineConfig?.pan_mode ?? 'pan';
  }

  public cyclePanMode(): void {
    const panMode = this.getEffectivePanMode();
    this._panMode =
      panMode === 'pan'
        ? 'seek'
        : panMode === 'seek'
          ? 'seek-in-media'
          : panMode === 'seek-in-media'
            ? 'seek-in-camera'
            : 'pan';
    this._host.requestUpdate();
  }

  public async setTimelineDate(date: Date): Promise<void> {
    if (!this._timeline) {
      return;
    }

    const currentWindow = this._timeline.getWindow();
    const durationSeconds = Math.max(
      60,
      differenceInSeconds(currentWindow.end, currentWindow.start),
    );
    const halfDuration = durationSeconds / 2;
    const targetWindow: TimelineWindow = {
      start: sub(date, { seconds: halfDuration }),
      end: add(date, { seconds: halfDuration }),
    };

    this._timeline.setWindow(targetWindow.start, targetWindow.end, { animation: false });
    await this._timelineRangeChangedHandler({
      start: targetWindow.start,
      end: targetWindow.end,
      byUser: true,
      event: new Event('date-picker') as Event & { additionalEvent: string },
    });
  }

  public hasTimeline(): boolean {
    return !!this._timeline;
  }

  public shouldSupportSeeking(): boolean {
    return this._mini;
  }

  public setTimelineElement(element?: HTMLElement): boolean {
    if (
      !this._source ||
      !this._timelineConfig ||
      (this._timeline && this._timelineElement === (element ?? null))
    ) {
      return false;
    }

    this.destroyTimeline();
    this._timelineElement = element ?? null;

    if (!this._timelineElement) {
      return false;
    }

    const options = this._getOptions();
    if (!options) {
      return false;
    }

    if (this._shouldShowGroups()) {
      this._timeline = new Timeline(
        this._timelineElement,
        this._source.dataset,
        this._source.groups,
        options,
      );
    } else {
      this._timeline = new Timeline(
        this._timelineElement,
        this._source.dataset,
        options,
      );
    }

    this._timeline.on('rangechanged', this._timelineRangeChangedHandler.bind(this));
    this._timeline.on('click', this._timelineClickHandler.bind(this));
    this._timeline.on('rangechange', this._timelineRangeChangeHandler.bind(this));

    // This complexity exists to ensure we can tell between a click that
    // causes the timeline zoom/range to change, and a 'static' click on the
    // // timeline (which may need to trigger a card wide event).
    this._timeline.on('mouseDown', (ev: TimelineEventPropertiesResult) => {
      const window = this._timeline?.getWindow();
      this._pointerHeld = {
        ...ev,
        ...(window && { window: window }),
      };
      this._ignoreClick = false;
    });
    this._timeline.on('mouseUp', () => {
      this._pointerHeld = null;
      this._removeTargetBar();
    });

    return true;
  }

  private _shouldShowGroups(): boolean {
    return !this._mini || (this._source?.groups.length ?? 0) > 1;
  }

  private _setTargetBarAppropriately(targetTime: Date): void {
    if (!this._timeline) {
      return;
    }

    if (this.shouldSupportSeeking() && this.getEffectivePanMode() !== 'pan') {
      if (!this._targetBarVisible) {
        this._timeline?.addCustomTime(targetTime, TIMELINE_TARGET_BAR_ID);
        this._targetBarVisible = true;
      } else {
        this._timeline?.setCustomTime(targetTime, TIMELINE_TARGET_BAR_ID);
      }

      const window = this._timeline.getWindow();
      const markerProportion =
        (targetTime.getTime() - window.start.getTime()) /
        (window.end.getTime() - window.start.getTime());

      // Position the marker proportionally to how 'far' the pointer is being
      // held relative to the timeline window.
      this._host.setAttribute(
        'target-bar-marker-direction',
        markerProportion < 0.25 ? 'right' : markerProportion > 0.75 ? 'left' : 'center',
      );
      this._timeline?.setCustomTimeMarker?.(
        formatDateAndTime(targetTime, true, this._hass),
        TIMELINE_TARGET_BAR_ID,
      );
    } else {
      this._removeTargetBar();
    }
  }

  private _removeTargetBar(): void {
    this._host.removeAttribute('target-bar-direction');
    if (this._targetBarVisible) {
      this._timeline?.removeCustomTime(TIMELINE_TARGET_BAR_ID);
      this._targetBarVisible = false;
    }
  }

  /**
   * Called whenever the range is in the process of being changed.
   * @param properties
   */
  private _timelineRangeChangeHandler(properties: TimelineRangeChange): void {
    if (this._pointerHeld) {
      this._ignoreClick = true;
    }

    if (
      this.shouldSupportSeeking() &&
      this._timeline &&
      properties.byUser &&
      // Do not adjust select/seek media during zoom events.
      properties.event.type !== 'wheel' &&
      properties.event.additionalEvent !== 'pinchin' &&
      properties.event.additionalEvent !== 'pinchout'
    ) {
      const targetTime = this._pointerHeld?.window
        ? add(properties.start, {
            seconds:
              (this._pointerHeld.time.getTime() -
                this._pointerHeld.window.start.getTime()) /
              1000,
          })
        : properties.end;

      if (this._pointerHeld) {
        this._setTargetBarAppropriately(targetTime);
      }

      void this._throttledSetViewDuringRangeChange(targetTime, properties);
    }
  }

  private async _setViewDuringRangeChange(
    targetTime: Date,
    properties: TimelineRangeChange,
  ): Promise<void> {
    const view = this._viewManagerEpoch?.manager.getView();
    const results = view?.queryResults;
    const media = results?.getResults();
    const panMode = this.getEffectivePanMode();
    if (
      !media ||
      !results ||
      !this._timeline ||
      !view ||
      !this._hass ||
      !this._cameraManager ||
      panMode === 'pan'
    ) {
      return;
    }

    const canSeek = this.shouldSupportSeeking();
    let newResults: QueryResults | null = null;

    if (panMode === 'seek') {
      newResults = results
        .clone()
        .selectBestResult(
          (mediaArray) => findBestMediaTimeIndex(mediaArray, targetTime, view?.camera),
          {
            allCameras: true,
            main: true,
          },
        );
    } else if (panMode === 'seek-in-camera' && view.camera) {
      newResults = results
        .clone()
        .selectBestResult(
          (mediaArray) => findBestMediaTimeIndex(mediaArray, targetTime),
          {
            cameraID: view.camera,
          },
        )
        .promoteCameraSelectionToMainSelection(view.camera);
    } else if (panMode === 'seek-in-media') {
      newResults = results;
    }

    const desiredView: AdvancedCameraCardView = this._mini
      ? targetTime >= new Date()
        ? 'live'
        : 'media'
      : view.view;

    const selectedItem = newResults?.getSelectedResult();
    const selectedCamera = ViewItemClassifier.isMedia(selectedItem)
      ? selectedItem.getCameraID()
      : null;

    this._viewManagerEpoch?.manager.setViewByParameters({
      params: {
        ...(selectedCamera && { camera: selectedCamera }),
        view: desiredView,
        queryResults: newResults,
      },
      modifiers: [
        new MergeContextViewModifier({
          ...(canSeek && { mediaViewer: { seek: targetTime } }),
          ...this._getTimelineContext({ start: properties.start, end: properties.end }),
        }),
      ],
    });
  }

  private _getTimelineContext(window?: TimelineWindow): ViewContext {
    const view = this._viewManagerEpoch?.manager.getView();
    const newWindow = window ?? this._timeline?.getWindow();
    return {
      timeline: {
        ...view?.context?.timeline,
        ...(newWindow && { window: newWindow }),
      },
    };
  }

  private async _timelineClickHandler(
    properties: TimelineEventPropertiesResult,
  ): Promise<void> {
    // Calls to stopEventFromActivatingCardWideActions() are included for
    // completeness. Timeline does not support card-wide events and they are
    // disabled in card.ts in `_getMergedActions`.
    if (
      this._ignoreClick ||
      (properties.what &&
        ['item', 'background', 'group-label', 'axis'].includes(properties.what))
    ) {
      stopEventFromActivatingCardWideActions(properties.event);
    }

    const view = this._viewManagerEpoch?.manager.getView();
    const id = properties.item ? String(properties.item) : null;
    const item = id ? this._source?.dataset.get(id) ?? null : null;

    if (
      this._ignoreClick ||
      !view ||
      !this._viewManagerEpoch ||
      !this._source ||
      !properties.what
    ) {
      return;
    }

    if (item && properties.what === 'item' && item.media) {
      let drawerAction: 'open' | 'close' = 'close';
      await this._selectItem(item, properties.time, String(properties.group));
      if (this._itemClickAction === 'select') {
        drawerAction = 'open';
      }
      fireAdvancedCameraCardEvent(this._host, `thumbnails:${drawerAction}`);
    } else {
      // Vis.js clears its internal selection when clicking background or axis.
      // Re-apply the selection from the current view so the active item remains highlighted.
      const mediaIDsToSelect = this._getAllSelectedMediaIDsFromView();
      this._timeline?.setSelection(mediaIDsToSelect, {
        focus: false,
        animation: {
          animation: false,
          zoom: false,
        },
      });
    }

    this._ignoreClick = false;
  }

  public async navigateMedia(direction: 'previous' | 'next'): Promise<void> {
    const view = this._viewManagerEpoch?.manager.getView();
    if (!view || !this._source) {
      return;
    }

    const currentSelection = this._timeline?.getSelection() ?? [];
    const currentId =
      (currentSelection.length ? String(currentSelection[0]) : null) ??
      (view.isViewerView()
        ? view.queryResults?.getSelectedResult()?.getID() ?? null
        : null);

    const currentMedia =
      (currentId
        ? this._source.dataset.get(currentId)?.media ??
          view.queryResults
            ?.getResults()
            ?.find(
              (m): m is ViewMedia =>
                ViewItemClassifier.isMedia(m) && m.getID() === currentId,
            ) ??
          null
        : null) ??
      (view.isViewerView() ? view.queryResults?.getSelectedResult() ?? null : null);

    if (!currentMedia && !currentId) {
      return;
    }

    const queryMedia =
      view.queryResults
        ?.getResults()
        ?.filter((m): m is ViewMedia => ViewItemClassifier.isMedia(m)) ?? [];

    let targetMedia: ViewMedia | null = null;
    let targetItem: AdvancedCameraCardTimelineItem | null = null;

    if (currentMedia && queryMedia.length > 0) {
      const currentIdx = queryMedia.findIndex((m) => m.getID() === currentMedia.getID());
      if (currentIdx !== -1) {
        const targetIdx = direction === 'previous' ? currentIdx - 1 : currentIdx + 1;
        if (targetIdx >= 0 && targetIdx < queryMedia.length) {
          targetMedia = queryMedia[targetIdx];
        }
      }
    }

    if (!targetMedia) {
      const currentTime =
        (currentMedia && ViewItemClassifier.isMedia(currentMedia)
          ? currentMedia.getStartTime()
          : null) ??
        this._timeline?.getWindow().start ??
        new Date();

      const currentDatasetItems = this._source.dataset.get({
        filter: (it: AdvancedCameraCardTimelineItem) =>
          !it.className?.includes('vis-background') && !!it.media,
      });
      const hasCoverage =
        currentDatasetItems.length > 1 &&
        currentDatasetItems.some(
          (it) =>
            it.id === currentMedia?.getID() ||
            (Number(it.start) <= currentTime.getTime() &&
              Number(it.end ?? it.start) >= currentTime.getTime()),
        );

      if (!hasCoverage) {
        await this._source.refresh(
          this._getPrefetchWindow({ start: currentTime, end: currentTime }),
          { force: true },
        );
      }

      let items = this._source.dataset.get({
        filter: (it: AdvancedCameraCardTimelineItem) =>
          !it.className?.includes('vis-background') && !!it.media,
      });
      items.sort((a, b) => Number(a.start) - Number(b.start));

      let currentIndex = currentMedia
        ? items.findIndex((it) => String(it.id) === currentMedia.getID())
        : -1;

      const timeMs = currentTime.getTime();
      if (currentIndex === -1) {
        if (direction === 'previous') {
          for (let i = items.length - 1; i >= 0; i--) {
            if (Number(items[i].start) < timeMs) {
              currentIndex = i + 1;
              break;
            }
          }
        } else {
          for (let i = 0; i < items.length; i++) {
            if (Number(items[i].start) > timeMs) {
              currentIndex = i - 1;
              break;
            }
          }
        }
      }

      let targetIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;

      if (targetIndex < 0 && direction === 'previous') {
        const prevChunkTime = sub(currentTime, { hours: this._source.chunkHours });
        await this._source.refresh(
          this._getPrefetchWindow({ start: prevChunkTime, end: prevChunkTime }),
        );
        items = this._source.dataset.get({
          filter: (it: AdvancedCameraCardTimelineItem) =>
            !it.className?.includes('vis-background') && !!it.media,
        });
        items.sort((a, b) => Number(a.start) - Number(b.start));
        for (let i = items.length - 1; i >= 0; i--) {
          if (Number(items[i].start) < timeMs) {
            targetIndex = i;
            break;
          }
        }
      } else if (targetIndex >= items.length && direction === 'next') {
        const nextChunkTime = add(currentTime, { hours: this._source.chunkHours });
        await this._source.refresh(
          this._getPrefetchWindow({ start: nextChunkTime, end: nextChunkTime }),
        );
        items = this._source.dataset.get({
          filter: (it: AdvancedCameraCardTimelineItem) =>
            !it.className?.includes('vis-background') && !!it.media,
        });
        items.sort((a, b) => Number(a.start) - Number(b.start));
        for (let i = 0; i < items.length; i++) {
          if (Number(items[i].start) > timeMs) {
            targetIndex = i;
            break;
          }
        }
      }

      if (targetIndex >= 0 && targetIndex < items.length) {
        targetItem = items[targetIndex];
        targetMedia = targetItem?.media ?? null;
      }
    }

    if (!targetMedia) {
      return;
    }

    const targetId = targetMedia.getID();
    const cameraID = targetMedia.getCameraID();
    const targetStart = targetMedia.getStartTime() ?? new Date();

    if (targetId) {
      this._timeline?.moveTo(targetStart);
      this._timeline?.setSelection(targetId);
    }

    let newResults = view.queryResults
      ?.clone()
      .resetSelectedResult()
      .selectResultIfFound((media) => media.getID() === targetId);

    if ((!newResults || !newResults.hasSelectedResult()) && targetItem) {
      const queryResults = this._buildQueryResultsFromExistingItem(targetItem);
      if (queryResults) {
        newResults = queryResults;
      }
    }

    if (!newResults || !newResults.hasSelectedResult()) {
      newResults = new QueryResults({ results: [targetMedia], selectedIndex: 0 });
    }

    const desiredView: AdvancedCameraCardView =
      this._itemClickAction === 'play' || view.isViewerView() ? 'media' : view.view;

    const targetQuery =
      targetItem?.query ??
      (this._source
        ? this._applyWindowToQuery(view.query ?? this._source.shape, {
            start: targetStart,
            end: targetStart,
          })
        : view.query ?? undefined);

    this._viewManagerEpoch?.manager.setViewByParameters({
      params: {
        view: desiredView,
        ...(targetQuery && { query: targetQuery }),
        queryResults: newResults,
        ...(cameraID && { camera: cameraID }),
      },
      modifiers: [
        new RemoveContextPropertyViewModifier('mediaViewer', 'seek'),
        new RemoveContextViewModifier(['timeline']),
      ],
    });

    if (this._itemClickAction === 'select') {
      fireAdvancedCameraCardEvent(this._host, 'thumbnails:open');
    }
  }

  private async _selectItem(
    item: AdvancedCameraCardTimelineItem,
    clickTime?: Date | null,
    group?: string,
  ): Promise<void> {
    const view = this._viewManagerEpoch?.manager.getView();
    if (!view || !this._viewManagerEpoch) {
      return;
    }

    const id = String(item.id);
    const cameraID = group || (item.group ? String(item.group) : '');
    const criteria = {
      main: true,
      ...(cameraID && view.isGrid() && { cameraID: cameraID }),
    };
    let newResults = view.queryResults
      ?.clone()
      .resetSelectedResult()
      .selectResultIfFound((media) => media.getID() === id, criteria);

    let isBuiltFromItem = false;
    if (!newResults || !newResults.hasSelectedResult()) {
      const queryResults = this._buildQueryResultsFromExistingItem(item);
      if (item && item.query && queryResults) {
        newResults = queryResults;
        isBuiltFromItem = true;
      }
    }

    const selectedItem = newResults?.getSelectedResult();
    let seekTime: Date | null = null;
    if (canMediaBeShownAsTimelineItem(selectedItem)) {
      const start = selectedItem.getStartTime();
      const end = selectedItem.getEndTime() ?? selectedItem.getUsableEndTime();
      if (start && end && end > start && clickTime) {
        if (clickTime < start || clickTime > end) {
          seekTime = start;
        } else {
          seekTime = clickTime;
        }
      }
    }
    const context: ViewContext = mergeViewContext(this._getTimelineContext(), {
      ...(seekTime && { mediaViewer: { seek: seekTime } }),
    });
    const modifiers = [
      ...(!seekTime
        ? [new RemoveContextPropertyViewModifier('mediaViewer', 'seek')]
        : []),
      new MergeContextViewModifier(context),
    ];

    if (isBuiltFromItem && item && item.query && newResults) {
      this._viewManagerEpoch.manager.setViewByParameters({
        params: {
          view: 'media',
          query: item.query,
          queryResults: newResults,
        },
        modifiers,
      });
    } else if (newResults?.hasSelectedResult()) {
      this._viewManagerEpoch.manager.setViewByParameters({
        params: {
          queryResults: newResults,
          view: this._itemClickAction === 'play' ? 'media' : view.view,
        },
        modifiers,
      });
    }
  }

  private _buildQueryResultsFromExistingItem(
    item: AdvancedCameraCardTimelineItem,
  ): QueryResults | null {
    const query = item.query;
    if (!query || !this._source) {
      return null;
    }
    const media = this._source.dataset
      .get({
        filter: (timelineItem) => !!timelineItem.query && query === timelineItem.query,
      })
      .map((timelineItem) => timelineItem.media)
      .filter(isTruthy);
    const selectedIndex = media.findIndex((m) => m.getID() === item.id);
    return selectedIndex >= 0
      ? new QueryResults({ results: media, selectedIndex })
      : null;
  }

  /**
   * Get a broader prefetch window from a start and end basis.
   * @param window The window to broaden.
   * @returns A broader timeline.
   */
  private _getPrefetchWindow(window: TimelineWindow): TimelineWindow {
    const delta = differenceInSeconds(window.end, window.start);
    return {
      start: sub(window.start, { seconds: delta }),
      end: add(window.end, { seconds: delta }),
    };
  }

  /**
   * Apply a cache-friendly prefetch window to all media queries.
   */
  private _applyWindowToQuery(
    query: UnifiedQuery,
    window: TimelineWindow,
  ): UnifiedQuery {
    const prefetchWindow = this._getPrefetchWindow(window);
    const cacheFriendlyWindow = convertRangeToCacheFriendlyTimes(prefetchWindow, {
      chunkHours: this._timelineConfig?.chunk_hours,
    });
    return UnifiedQueryTransformer.rebuildQuery(
      UnifiedQueryTransformer.stripLimits(query),
      {
        start: cacheFriendlyWindow.start,
        end: cacheFriendlyWindow.end,
      },
    );
  }

  private _timelineRangeChangedHandler = async (properties: {
    start: Date;
    end: Date;
    byUser: boolean;
    event: Event & { additionalEvent: string };
  }): Promise<void> => {
    this._removeTargetBar();
    const view = this._viewManagerEpoch?.manager.getView();

    if (
      !this._timeline ||
      !view ||
      // When in mini mode, something else is in charge of the primary media
      // population (e.g. the live view), in this case only act when the user
      // themselves are interacting with the timeline.
      (this._mini && !properties.byUser)
    ) {
      return;
    }

    await this._source?.refresh(this._getPrefetchWindow(properties));

    if (view.isViewerView() || !view.query) {
      return;
    }
    const query = this._applyWindowToQuery(view.query, properties);

    if (this._alreadyHasAcceptableMediaQuery(query)) {
      return;
    }

    await this._viewManagerEpoch?.manager.setViewByParametersWithExistingQuery({
      params: {
        query,
      },
      queryExecutorOptions: {
        selectResult: {
          id:
            this._viewManagerEpoch?.manager
              .getView()
              ?.queryResults?.getSelectedResult()
              ?.getID() ?? undefined,
        },
      },
      modifiers: [new MergeContextViewModifier(this._getTimelineContext())],
    });
  };

  private _alreadyHasAcceptableMediaQuery(freshQuery: UnifiedQuery): boolean {
    const view = this._viewManagerEpoch?.manager.getView();
    const query = view?.query;

    if (!this._source || !query) {
      return false;
    }

    const currentResultTimestamp = view?.queryResults?.getResultsTimestamp();
    if (!currentResultTimestamp) {
      return false;
    }

    return (
      query.isSupersetOf(freshQuery) &&
      this._source.areResultsFresh(currentResultTimestamp, query)
    );
  }

  private async _updateTimelineFromView(): Promise<void> {
    const view = this._viewManagerEpoch?.manager.getView();
    if (!view || !this._timelineConfig || !this._source || !this._timeline) {
      return;
    }

    const timelineWindow = this._timeline.getWindow();

    // Calculate the timeline window to show. If there is a window set in the
    // view context, always honor that. Otherwise, if there's a selected media
    // item that is already within the current window (even if it's not
    // perfectly positioned) -- leave it as is. Otherwise, change the window to
    // perfectly center on the media.

    let desiredWindow = timelineWindow;
    const item = view.queryResults?.getSelectedResult();
    const media = item && ViewItemClassifier.isMedia(item) ? item : null;
    const mediaStartTime = media?.getStartTime() ?? null;
    const mediaEndTime = media?.getEndTime() ?? null;
    const mediaIsEvent = media
      ? ViewItemClassifier.isEvent(media) || ViewItemClassifier.isReview(media)
      : false;

    const mediaWindow: TimelineWindow | null =
      media && mediaStartTime
        ? // If this media has no end time, it's just a "point" in time so the
          // range effectively starts/ends at the same time.
          { start: mediaStartTime, end: mediaEndTime ?? mediaStartTime }
        : null;
    const context = view.context?.timeline;

    if (
      context &&
      context.window &&
      (!mediaWindow || rangesOverlap(mediaWindow, context.window))
    ) {
      desiredWindow = context.window;
    } else if (mediaWindow) {
      const perfectMediaWindow = this._getPerfectWindowFromMediaStartAndEndTime(
        mediaIsEvent,
        mediaStartTime,
        mediaEndTime,
      );
      if (perfectMediaWindow) {
        desiredWindow = perfectMediaWindow;
      }
    }
    const prefetchedWindow = this._getPrefetchWindow(desiredWindow);

    // Set the timeline window immediately if necessary.
    if (!this._pointerHeld && !isEqual(desiredWindow, timelineWindow)) {
      this._timeline.setWindow(desiredWindow.start, desiredWindow.end);
    }

    if (!this._pointerHeld) {
      const earlyDatasetQuery = view.query ?? this._source.shape;
      if (earlyDatasetQuery) {
        this._source.addMediaToDataset(
          earlyDatasetQuery,
          view.queryResults?.getResults(),
        );
      }
    }

    const currentSelection = this._timeline.getSelection();
    const mediaIDsToSelect = this._getAllSelectedMediaIDsFromView();

    const selectMediaIDs = (mediaIDs: IdType[]) => {
      if (this._isClustering()) {
        // Hack: Clustering may not update unless the dataset changes, artifically
        // update the dataset to ensure the newly selected item cannot be included
        // in a cluster.

        for (const mediaID of mediaIDs) {
          // Need to this rewrite prior to setting the selection (just below), or
          // the selection will be lost on rewrite.
          this._source?.rewriteEvent(mediaID);
        }
      }

      this._timeline?.setSelection(mediaIDs, {
        focus: false,
        animation: {
          animation: false,
          zoom: false,
        },
      });
    };

    const needToSelect =
      currentSelection.length !== mediaIDsToSelect.length ||
      mediaIDsToSelect.some((mediaID) => !currentSelection.includes(mediaID));

    if (needToSelect) {
      selectMediaIDs(mediaIDsToSelect);
    }

    if (!this._pointerHeld) {
      // Don't fetch any data or touch the timeline in any way if the user is
      // currently interacting with it. Without this the subsequent data fetches
      // (via fetchIfNecessary) may update the timeline contents which causes
      // the visjs timeline to stop dragging/panning operations which is very
      // disruptive to the user.
      const hasEventsInWindow =
        (this._source?.dataset.get({
          filter: (it) =>
            !it.className?.includes('vis-background') &&
            Number(it.end ?? it.start) >= prefetchedWindow.start.getTime() &&
            Number(it.start) <= prefetchedWindow.end.getTime(),
        }).length ?? 0) > 0;

      await this._source?.refresh(prefetchedWindow, { force: !hasEventsInWindow });
      // Use the view's query if available. When navigateMedia builds results
      // directly from the existing timeline item (view.query is null), fall back
      // to the source's shape so the item is still added to the dataset.
      const datasetQuery = view.query ?? this._source.shape;
      if (datasetQuery) {
        this._source.addMediaToDataset(datasetQuery, view.queryResults?.getResults());
      }
      if (mediaIDsToSelect.length) {
        selectMediaIDs(mediaIDsToSelect);
      }
    }

    // Only generate thumbnails if the existing query is not an acceptable
    // match, to avoid getting stuck in a loop (the subsequent fetches will not
    // actually fetch since the data will have been cached).
    //
    // Timeline receives a new `view`
    //  -> Events fetched
    //    -> Thumbnails generated
    //      -> New view dispatched (to load thumbnails into outer carousel).
    //  -> New view received ... [loop]
    //
    // Also don't generate thumbnails in mini-timelines (they will already have
    // been generated).
    if (view.isViewerView() || !view.query) {
      return;
    }

    const freshMediaQuery = this._applyWindowToQuery(view.query, desiredWindow);

    if (
      !this._mini &&
      freshMediaQuery &&
      !this._alreadyHasAcceptableMediaQuery(freshMediaQuery)
    ) {
      const currentlySelectedResult = this._viewManagerEpoch?.manager
        .getView()
        ?.queryResults?.getSelectedResult();

      await this._viewManagerEpoch?.manager.setViewByParametersWithExistingQuery({
        params: {
          query: freshMediaQuery,
        },
        queryExecutorOptions: {
          selectResult: {
            id: currentlySelectedResult?.getID() ?? undefined,
          },
        },
        modifiers: [
          new MergeContextViewModifier(this._getTimelineContext(desiredWindow)),
        ],
      });
    }
  }

  private _getAllSelectedMediaIDsFromView(): IdType[] {
    const view = this._viewManagerEpoch?.manager.getView();
    return (
      view?.queryResults?.getMultipleSelectedResults({
        main: true,
        ...(view.isGrid() && { allCameras: true }),
      }) ?? []
    )
      .filter((media) => canMediaBeShownAsTimelineItem(media))
      .map((media) => media.getID())
      .filter(isTruthy);
  }

  private _isClustering(): boolean {
    return (
      this._timelineConfig?.style === 'stack' &&
      !!this._timelineConfig?.clustering_threshold &&
      this._timelineConfig.clustering_threshold > 0
    );
  }

  private _getPerfectWindowFromMediaStartAndEndTime(
    isEvent: boolean,
    startTime: Date | null,
    endTime: Date | null,
  ): TimelineWindow | null {
    if (isEvent) {
      const windowSeconds = this._getConfiguredWindowSeconds();

      if (startTime && endTime) {
        if (endTime.getTime() - startTime.getTime() > windowSeconds * 1000) {
          // If the event is larger than the configured window, only show the most
          // recent portion of the event that fits in the window.
          return {
            start: sub(endTime, { seconds: windowSeconds }),
            end: endTime,
          };
        } else {
          // If the event is shorter than the configured window, center the event
          // in the window.
          const gap = windowSeconds - (endTime.getTime() - startTime.getTime()) / 1000;
          return {
            start: sub(startTime, { seconds: gap / 2 }),
            end: add(endTime, { seconds: gap / 2 }),
          };
        }
      } else if (startTime) {
        // If there's no end-time yet, place the start-time in the center of the
        // time window.
        return {
          start: sub(startTime, { seconds: windowSeconds / 2 }),
          end: add(startTime, { seconds: windowSeconds / 2 }),
        };
      }
    } else if (startTime && endTime) {
      return {
        start: startTime,
        end: endTime,
      };
    }
    return null;
  }

  private _getConfiguredWindowSeconds(): number {
    return (
      this._timelineConfig?.window_seconds ?? timelineCoreConfigDefault.window_seconds
    );
  }

  /**
   * Get desired timeline start/end time.
   * @returns A tuple of start/end date.
   */
  private _getDefaultStartEnd(): TimelineWindow {
    const end = new Date();
    const start = sub(end, {
      seconds: this._getConfiguredWindowSeconds(),
    });
    return { start: start, end: end };
  }

  private _getDateTimeFormat(): TimelineFormatOption {
    const format24Hour = !!this._timelineConfig?.format?.['24h'];

    // See: https://visjs.github.io/vis-timeline/docs/timeline/#Configuration_Options
    return {
      minorLabels: {
        minute: format24Hour ? 'HH:mm' : 'h:mm A',
        hour: format24Hour ? 'HH:mm' : 'h:mm A',
      },
      majorLabels: {
        millisecond: format24Hour ? 'HH:mm:ss' : 'h:mm:ss A',
        second: format24Hour ? 'D MMMM HH:mm' : 'D MMMM h:mm A',
      },
    };
  }

  private _canCluster(first: TimelineItem, second: TimelineItem): boolean {
    const selectedIDs = this._getAllSelectedMediaIDsFromView();
    const firstMedia = (<AdvancedCameraCardTimelineItem>first).media;
    const secondMedia = (<AdvancedCameraCardTimelineItem>second).media;

    // Never include the currently selected item in a cluster.
    if (
      first.type === 'background' ||
      first.type !== second.type ||
      selectedIDs.includes(first.id) ||
      selectedIDs.includes(second.id) ||
      !firstMedia ||
      !secondMedia
    ) {
      return false;
    }

    // Events cluster with events and reviews with reviews.
    return (
      (ViewItemClassifier.isEvent(firstMedia) &&
        ViewItemClassifier.isEvent(secondMedia)) ||
      (ViewItemClassifier.isReview(firstMedia) &&
        ViewItemClassifier.isReview(secondMedia))
    );
  }

  private _getOptions(): TimelineOptions | null {
    if (!this._timelineConfig) {
      return null;
    }

    const defaultWindow = this._getDefaultStartEnd();
    const stack = this._timelineConfig.style === 'stack';
    const lang =
      this._timelineConfig.format?.locale ??
      (this._hass ? getLanguage(this._hass) : 'en');
    const locale = getTimelineLocale(lang);
    setMomentLocale(locale);

    // Configuration for the Timeline, see:
    // https://visjs.github.io/vis-timeline/docs/timeline/#Configuration_Options
    return {
      locale,
      locales: TIMELINE_LOCALES,
      cluster: this._isClustering()
        ? {
            // It would be better to automatically calculate `maxItems` from the
            // rendered height of the timeline (or group within the timeline) so
            // as to not waste vertical space (e.g. after the user changes to
            // fullscreen mode). Unfortunately this is not easy to do, as we
            // don't know the height of the timeline until after it renders --
            // and if we adjust `maxItems` then we can get into an infinite
            // resize loop. Adjusting the `maxItems` of a timeline, after it's
            // created, also does not appear to work as expected.
            maxItems: this._timelineConfig.clustering_threshold,

            clusterCriteria: this._canCluster.bind(this),
          }
        : // Timeline type information is incorrect requiring this 'as'.
          (false as unknown as TimelineOptionsCluster),

      dataAttributes: ['severity'],

      minHeight: '100%',
      maxHeight: '100%',
      zoomMax: 1 * 24 * 60 * 60 * 1000,
      zoomMin: 1 * 1000,
      margin: {
        item: {
          // In ribbon mode, a 20px item is reduced to 6px, so need to add a
          // 14px margin to ensure items line up with subgroups.
          vertical: stack ? 10 : 24,
        },
      },
      selectable: true,
      stack: stack,
      start: defaultWindow.start,
      end: defaultWindow.end,
      groupHeightMode: 'auto',
      tooltip: {
        followMouse: true,
        overflowMethod: 'cap',
        template: this._getTooltip.bind(this),
      },
      format: this._getDateTimeFormat(),
      xss: {
        disabled: false,
        filterOptions: {
          whiteList: {
            'advanced-camera-card-timeline-thumbnail': ['details', 'item'],
            div: ['title'],
            span: ['style'],
          },
        },
      },
    };
  }

  /**
   * Get a tooltip for a given timeline event.
   * @param item The TimelineItem in question.
   * @returns The tooltip as a string to render.
   */
  private _getTooltip(item: TimelineItem): string {
    if (!this._isHoverableDevice) {
      // Don't display tooltips on touch devices, they just get in the way of
      // the drawer.
      return '';
    }

    // Cannot use Lit data-bindings as visjs requires a string for tooltips.
    // Note that changes to attributes here must be mirrored in the xss
    // whitelist in `_getOptions()` .
    return `
        <advanced-camera-card-timeline-thumbnail
          item='${item.id}'
          ${this._thumbnailConfig?.show_details ? 'details' : ''}
        >
        </advanced-camera-card-timeline-thumbnail>`;
  }
}

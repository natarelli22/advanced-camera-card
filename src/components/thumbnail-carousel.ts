import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';

import { CameraQueryClassifier, type CameraManager } from '../camera-manager/manager.js';
import type { DateRange } from '../camera-manager/range.js';
import { convertRangeToCacheFriendlyTimes } from '../camera-manager/utils/range-to-cache-friendly.js';
import type { FoldersManager } from '../card-controller/folders/manager.js';
import type { ViewItemManager } from '../card-controller/view/item-manager.js';
import { MergeContextViewModifier } from '../card-controller/view/modifiers/merge-context.js';
import { RemoveContextPropertyViewModifier } from '../card-controller/view/modifiers/remove-context-property.js';
import { RemoveContextViewModifier } from '../card-controller/view/modifiers/remove-context.js';
import { sortItems } from '../card-controller/view/sort.js';
import type { ViewManagerEpoch, ViewModifier } from '../card-controller/view/types.js';
import {
  getUpFolderItem,
  navigateToFolder,
  navigateToMedia,
  navigateUp,
  type FolderNavigationParamaters,
} from '../components-lib/navigation.js';
import type { ConditionStateManagerReadonlyInterface } from '../condition-trigger/conditions/types.js';
import type { ThumbnailsControlConfig } from '../config/schema/common/controls/thumbnails.js';
import type { CardWideConfig } from '../config/schema/types.js';
import type { HomeAssistant } from '../ha/types.js';
import { QuerySource } from '../query-source.js';
import thumbnailCarouselStyle from '../scss/thumbnail-carousel.scss?inline';
import { stopEventFromActivatingCardWideActions } from '../utils/action.js';
import { errorToConsole } from '../utils/basic.js';
import type {
  CarouselDirection,
  CarouselSelected,
} from '../utils/embla/carousel-controller.js';
import { fireAdvancedCameraCardEvent } from '../utils/fire-advanced-camera-card-event.js';
import { syncGridResultsForTargetTime } from '../utils/grid-sync.js';
import { Timer } from '../utils/timer.js';
import { ViewItemClassifier } from '../view/item-classifier.js';
import type { ViewItem, ViewMedia } from '../view/item.js';
import { QueryResults } from '../view/query-results.js';
import { UnifiedQueryBuilder } from '../view/unified-query-builder.js';
import { UnifiedQueryRunner } from '../view/unified-query-runner.js';
import { UnifiedQueryTransformer } from '../view/unified-query-transformer.js';
import { UnifiedQuery } from '../view/unified-query.js';
import { getReviewedQueryFilterFromQuery } from '../view/utils/query-filter.js';
import type { AdvancedCameraCardCarousel } from './carousel.js';

import './carousel.js';
import './thumbnail/thumbnail.js';

interface ThumbnailMediaSelect {
  media: ViewMedia;
}

@customElement('advanced-camera-card-thumbnail-carousel')
export class AdvancedCameraCardThumbnailCarousel extends LitElement {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public foldersManager?: FoldersManager;

  @property({ attribute: false })
  public conditionStateManager?: ConditionStateManagerReadonlyInterface;

  @property({ attribute: false })
  public viewItemManager?: ViewItemManager;

  @property({ attribute: false })
  public config?: ThumbnailsControlConfig;

  @property({ attribute: false })
  public cardWideConfig?: CardWideConfig;

  @property({ attribute: false })
  public fadeThumbnails = false;

  @property({ type: Boolean, reflect: true })
  public locked?: boolean;

  private _refCarousel: Ref<AdvancedCameraCardCarousel> = createRef();
  private _boundDrawerOpened = this._onDrawerOpened.bind(this);
  private _thumbnails: unknown = null;
  private _builder: UnifiedQueryBuilder | null = null;

  private _items: ViewItem[] = [];
  private _query: UnifiedQuery | null = null;
  private _queryResults: QueryResults | null = null;
  private _currentChunk: DateRange | null = null;
  private _isLoadingChunk = false;
  private _targetSlideIndex: number | null = null;
  private _lastCameraKey: string | null = null;
  private _previousSelectedIndex: number | null = null;
  private _hasOlder = true;
  private _hasNewer = true;

  public connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(
      'advanced-camera-card:drawer:opened',
      this._boundDrawerOpened,
    );
    window.addEventListener('advanced-camera-card:drawer:open', this._boundDrawerOpened);
  }

  public disconnectedCallback(): void {
    window.removeEventListener(
      'advanced-camera-card:drawer:opened',
      this._boundDrawerOpened,
    );
    window.removeEventListener(
      'advanced-camera-card:drawer:open',
      this._boundDrawerOpened,
    );
    super.disconnectedCallback();
  }

  private _onDrawerOpened(ev: Event): void {
    const detail = (ev as CustomEvent<{ drawer?: string }>).detail;
    if (detail?.drawer && detail.drawer !== this.config?.mode) {
      return;
    }
    this._checkAndLoadInitialChunk();
    const targetSlide = this._getScrollSlide();
    if (targetSlide !== null && this._refCarousel.value) {
      requestAnimationFrame(() => {
        this._refCarousel.value?.scrollToSelected(true);
      });
    }
  }

  private _getFolderNavOptions(): FolderNavigationParamaters | undefined {
    return this._builder && this.viewManagerEpoch
      ? {
          builder: this._builder,
          viewManagerEpoch: this.viewManagerEpoch,
        }
      : undefined;
  }

  private _getNonRecordingQuery(
    query?: UnifiedQuery | null,
    cameraID?: string,
  ): UnifiedQuery | null {
    if (query) {
      const nodes = query.getNodes().filter((node) => {
        if (
          node.source === QuerySource.Camera &&
          CameraQueryClassifier.isRecordingQuery(node)
        ) {
          return false;
        }
        return true;
      });
      if (nodes.length > 0) {
        return new UnifiedQuery(nodes);
      }
    }
    if (this._builder) {
      const eventsQuery = this._builder.buildCameraMediaQuery('events', {
        cameraID,
        eventsSubtype: 'clips',
      });
      if (eventsQuery?.hasNodes()) {
        return eventsQuery;
      }
      const defaultQuery = this._builder.buildDefaultCameraQuery(cameraID);
      if (defaultQuery) {
        const nodes = defaultQuery.getNodes().filter((node) => {
          if (
            node.source === QuerySource.Camera &&
            CameraQueryClassifier.isRecordingQuery(node)
          ) {
            return false;
          }
          return true;
        });
        if (nodes.length > 0) {
          return new UnifiedQuery(nodes);
        }
      }
    }
    return null;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (
      (changedProps.has('cameraManager') || changedProps.has('foldersManager')) &&
      this.cameraManager &&
      this.foldersManager
    ) {
      this._builder = new UnifiedQueryBuilder(this.cameraManager, this.foldersManager);
    }

    if (changedProps.has('config')) {
      if (this.config?.size) {
        this.style.setProperty(
          '--advanced-camera-card-thumbnail-size',
          `${this.config.size}px`,
        );
      }
      const direction = this._getDirection();
      if (direction) {
        this.setAttribute('direction', direction);
      } else {
        this.removeAttribute('direction');
      }
    }

    const renderProperties = [
      'cameraManager',
      'config',
      'transitionEffect',
      'viewManagerEpoch',
    ] as const;
    if (renderProperties.some((prop) => changedProps.has(prop))) {
      this._checkAndLoadInitialChunk();
    }

    if (changedProps.has('viewManagerEpoch')) {
      this.style.setProperty(
        '--advanced-camera-card-carousel-thumbnail-opacity',
        !this.fadeThumbnails || this._getSelectedSlide() === null ? '1.0' : '0.4',
      );
    }
  }

  private _checkAndLoadInitialChunk(): void {
    const view = this.viewManagerEpoch?.manager.getView();
    if (!view || !this.cameraManager || !this.foldersManager) {
      return;
    }

    if (this.config?.chunk_size) {
      const cameraForQuery = view.camera ?? undefined;
      const cameraKey = view.isGrid()
        ? `grid_${cameraForQuery ?? 'default'}`
        : cameraForQuery ?? 'default';

      const selectedResult = view.queryResults?.getSelectedResult();
      let refTime: Date | null =
        view.context?.mediaViewer?.seek ??
        (selectedResult && ViewItemClassifier.isMedia(selectedResult)
          ? selectedResult.getStartTime()
          : null);
      if (!refTime && view.queryResults && view.queryResults.getResultsCount() > 0) {
        const results = view.queryResults.getResults();
        const lastItem = results && results.length ? results[results.length - 1] : null;
        if (lastItem && ViewItemClassifier.isMedia(lastItem)) {
          refTime = lastItem.getStartTime() ?? null;
        }
      }
      if (!refTime) {
        refTime = new Date();
      }

      if (this._lastCameraKey !== cameraKey) {
        this._items = [];
        this._query = null;
        this._queryResults = null;
        this._previousSelectedIndex = null;
        this._targetSlideIndex = null;
        this._hasOlder = true;
        this._hasNewer = true;
        this._lastCameraKey = cameraKey;
      } else if (this._items.length > 0) {
        const oldestItem = this._items[0];
        const newestItem = this._items[this._items.length - 1];
        const oldestTime = ViewItemClassifier.isMedia(oldestItem)
          ? oldestItem.getStartTime()
          : null;
        const newestTime = ViewItemClassifier.isMedia(newestItem)
          ? newestItem.getStartTime()
          : null;

        if (oldestTime && newestTime && refTime >= oldestTime && refTime <= newestTime) {
          this._targetSlideIndex =
            this._getSelectedSlide(this._items) ?? this._previousSelectedIndex;
          this._thumbnails = this._renderThumbnails();
          this.requestUpdate();
          void this.updateComplete.then(() => {
            this._targetSlideIndex = null;
          });
          return;
        } else {
          // Outside current buffer, force reload around refTime
          this._items = [];
          this._query = null;
          this._queryResults = null;
          this._previousSelectedIndex = null;
          this._targetSlideIndex = null;
          this._hasOlder = true;
          this._hasNewer = true;
        }
      } else {
        this._lastCameraKey = cameraKey;
      }

      void this._loadInitialChunkSize(refTime, this.config.chunk_size);
      return;
    }

    const chunkHours = this.config?.chunk_hours ?? 24;
    const isFolderView = !!view.query?.hasFolderQueries();
    if (isFolderView) {
      this._items = view.queryResults?.getResults() ?? [];
      this._thumbnails = this._renderThumbnails();
      return;
    }

    const selectedResult = view.queryResults?.getSelectedResult();
    let refTime: Date | null =
      view.context?.mediaViewer?.seek ??
      (selectedResult && ViewItemClassifier.isMedia(selectedResult)
        ? selectedResult.getStartTime()
        : null);

    if (!refTime && view.queryResults && view.queryResults.getResultsCount() > 0) {
      const results = view.queryResults.getResults();
      const lastItem = results && results.length ? results[results.length - 1] : null;
      if (lastItem && ViewItemClassifier.isMedia(lastItem)) {
        refTime = lastItem.getStartTime() ?? null;
      }
    }

    if (!refTime) {
      refTime = new Date();
    }

    const cameraForQuery = view.camera ?? undefined;
    const cameraKey = view.isGrid()
      ? `grid_${cameraForQuery ?? 'default'}`
      : cameraForQuery ?? 'default';
    if (
      this._currentChunk &&
      this._lastCameraKey === cameraKey &&
      refTime >= this._currentChunk.start &&
      refTime <= this._currentChunk.end
    ) {
      this._thumbnails = this._renderThumbnails();
      return;
    }

    if (this._lastCameraKey !== cameraKey) {
      this._currentChunk = null;
      if (view.queryResults && view.queryResults.getResultsCount() > 0) {
        const allResults = view.queryResults.getResults() ?? [];
        this._items = cameraForQuery
          ? allResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) &&
                !ViewItemClassifier.isRecording(it) &&
                it.getCameraID() === cameraForQuery,
            )
          : allResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
            );
      } else {
        this._items = [];
      }
      this._thumbnails = this._renderThumbnails();
    } else if (
      !this._items.length &&
      view.queryResults &&
      view.queryResults.getResultsCount() > 0
    ) {
      const allResults = view.queryResults.getResults() ?? [];
      this._items = cameraForQuery
        ? allResults.filter(
            (it) =>
              ViewItemClassifier.isMedia(it) &&
              !ViewItemClassifier.isRecording(it) &&
              it.getCameraID() === cameraForQuery,
          )
        : allResults.filter(
            (it) =>
              ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
          );
      this._thumbnails = this._renderThumbnails();
    }

    this._lastCameraKey = cameraKey;
    const chunk = convertRangeToCacheFriendlyTimes(
      { start: refTime, end: refTime },
      { chunkHours },
    );
    void this._loadChunk(chunk);
  }

  private async _loadInitialChunkSize(refTime: Date, chunkSize: number): Promise<void> {
    const view = this.viewManagerEpoch?.manager.getView();
    if (!this.cameraManager || !this.foldersManager || !view || this._isLoadingChunk) {
      return;
    }

    this._isLoadingChunk = true;
    try {
      const dummyConditionStateManager: ConditionStateManagerReadonlyInterface = {
        getState: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      };
      const runner = new UnifiedQueryRunner(
        this.cameraManager,
        this.foldersManager,
        this.conditionStateManager ?? dummyConditionStateManager,
      );

      const isFolderView = !!view.query?.hasFolderQueries();
      const cameraForQuery = view.camera ?? undefined;

      if (isFolderView) {
        const rawResults = view.queryResults?.getResults() ?? [];
        this._items = cameraForQuery
          ? rawResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) && it.getCameraID() === cameraForQuery,
            )
          : rawResults;
        this._query = view.query ?? null;
        this._queryResults = view.queryResults ?? null;
        this._thumbnails = this._renderThumbnails();
        this.requestUpdate();
        return;
      }

      let baseQuery = view.query;
      if (baseQuery && cameraForQuery) {
        baseQuery = UnifiedQueryTransformer.filterByCamera(baseQuery, cameraForQuery);
      }
      baseQuery = this._getNonRecordingQuery(baseQuery, cameraForQuery);

      if (!baseQuery || !baseQuery.hasNodes()) {
        this._items = [];
        this._query = null;
        this._queryResults = null;
        this._thumbnails = [];
        this.requestUpdate();
        return;
      }

      const existingResults = view.queryResults?.getResults();
      const selectedResult = view.queryResults?.getSelectedResult();
      if (existingResults && existingResults.length > 0) {
        const filtered = cameraForQuery
          ? existingResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) &&
                !ViewItemClassifier.isRecording(it) &&
                it.getCameraID() === cameraForQuery,
            )
          : existingResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
            );

        if (filtered.length > 0) {
          let selIndex =
            selectedResult && !ViewItemClassifier.isRecording(selectedResult)
              ? filtered.findIndex((it) => it.getID() === selectedResult.getID())
              : -1;
          if (selIndex === -1) {
            selIndex = filtered.findIndex((it) => {
              const st = ViewItemClassifier.isMedia(it) ? it.getStartTime() : null;
              return st && st >= refTime;
            });
            if (selIndex === -1) {
              selIndex = filtered.length - 1;
            }
          }

          let start = Math.max(0, selIndex - Math.floor(chunkSize / 2));
          let end = start + chunkSize;
          if (end > filtered.length) {
            end = filtered.length;
            start = Math.max(0, end - chunkSize);
          }
          this._items = filtered.slice(start, end);
          this._query = baseQuery;
          this._queryResults = new QueryResults({ results: this._items });
          this._hasOlder = true;
          this._hasNewer = true;
          this._previousSelectedIndex = Math.min(
            selIndex - start,
            Math.max(0, this._items.length - 1),
          );
          this._thumbnails = this._renderThumbnails();
          this.requestUpdate();

          await this.updateComplete;
          if (this._refCarousel.value) {
            this._refCarousel.value.scrollToSelected(true);
          }
          return;
        }
      }

      let query = UnifiedQueryTransformer.stripTimeRange(
        UnifiedQueryTransformer.stripLimits(baseQuery),
      );
      query = UnifiedQueryTransformer.rebuildQuery(query, {
        end: refTime,
        limit: chunkSize,
      });

      let items = await runner.execute(query, { useCache: true });
      items = items.filter((it) => !ViewItemClassifier.isRecording(it));
      if (items.length === 0 && refTime < new Date()) {
        const recentQuery = UnifiedQueryTransformer.rebuildQuery(
          UnifiedQueryTransformer.stripTimeRange(
            UnifiedQueryTransformer.stripLimits(baseQuery),
          ),
          { limit: chunkSize },
        );
        items = await runner.execute(recentQuery, { useCache: true });
        items = items.filter((it) => !ViewItemClassifier.isRecording(it));
      }

      items = sortItems(items);
      if (items.length > chunkSize) {
        items = items.slice(items.length - chunkSize);
      }

      this._items = items;
      this._query = query;
      this._queryResults = new QueryResults({ results: items });
      this._hasOlder = true;
      this._hasNewer = true;

      let targetIndex = this._getSelectedSlide(items);
      if (targetIndex === null && items.length > 0 && refTime) {
        const hasUpFolder = !!getUpFolderItem(view.query);
        let closestIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const st = ViewItemClassifier.isMedia(it) ? it.getStartTime() : null;
          if (st) {
            const diff = Math.abs(st.getTime() - refTime.getTime());
            if (diff < minDiff) {
              minDiff = diff;
              closestIndex = i;
            }
          }
        }
        targetIndex = closestIndex + (hasUpFolder ? 1 : 0);
      }

      this._targetSlideIndex = targetIndex ?? Math.max(0, items.length - 1);
      this._previousSelectedIndex = this._targetSlideIndex;
      this._thumbnails = this._renderThumbnails();
      this.requestUpdate();

      await this.updateComplete;
      if (this._refCarousel.value) {
        this._refCarousel.value.scrollToSelected(true);
        this._targetSlideIndex = null;
      }
    } catch (e) {
      errorToConsole(e);
    } finally {
      this._isLoadingChunk = false;
    }
  }

  private async _loadOlderChunk(chunkSize: number): Promise<void> {
    if (this._isLoadingChunk || !this._items.length || !this._hasOlder) {
      return;
    }

    const view = this.viewManagerEpoch?.manager.getView();
    if (!this.cameraManager || !this.foldersManager || !view) {
      return;
    }

    const cameraForQuery = view.camera ?? undefined;
    const mediaItems = cameraForQuery
      ? this._items.filter(
          (it) =>
            ViewItemClassifier.isMedia(it) &&
            !ViewItemClassifier.isRecording(it) &&
            it.getCameraID() === cameraForQuery,
        )
      : this._items.filter(
          (it) => ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
        );

    const oldestItem = mediaItems[0];
    const oldestTime =
      oldestItem && ViewItemClassifier.isMedia(oldestItem)
        ? oldestItem.getStartTime()
        : null;
    if (!oldestTime) {
      return;
    }

    this._isLoadingChunk = true;
    try {
      const dummyConditionStateManager: ConditionStateManagerReadonlyInterface = {
        getState: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      };
      const runner = new UnifiedQueryRunner(
        this.cameraManager,
        this.foldersManager,
        this.conditionStateManager ?? dummyConditionStateManager,
      );

      let baseQuery = view.query;
      if (baseQuery && cameraForQuery) {
        baseQuery = UnifiedQueryTransformer.filterByCamera(baseQuery, cameraForQuery);
      }
      baseQuery = this._getNonRecordingQuery(baseQuery, cameraForQuery);
      if (!baseQuery || !baseQuery.hasNodes()) {
        return;
      }

      const olderQuery = UnifiedQueryTransformer.stripTimeRange(
        UnifiedQueryTransformer.stripLimits(baseQuery),
      );

      const chunkHours = this.config?.chunk_hours ?? 24;
      let rawItems: ViewItem[] = [];
      let currentEnd = new Date(oldestTime.getTime() - 1);
      let attempts = 0;
      const maxAttempts = 7;

      while (rawItems.length === 0 && attempts < maxAttempts) {
        attempts++;
        const currentStart = new Date(
          currentEnd.getTime() - chunkHours * 60 * 60 * 1000,
        );
        const loopQuery = UnifiedQueryTransformer.rebuildQuery(olderQuery, {
          start: currentStart,
          end: currentEnd,
        });

        let items = await runner.execute(loopQuery, { useCache: true });
        items = items.filter((it) => !ViewItemClassifier.isRecording(it));
        if (items.length > 0) {
          rawItems = items;
        } else {
          currentEnd = new Date(currentStart.getTime() - 1);
        }
      }

      const currentIds = new Set(this._items.map((it) => it.getID()));
      const uniqueOlder = rawItems.filter((it) => !currentIds.has(it.getID()));

      if (!uniqueOlder.length) {
        this._hasOlder = false;
        return;
      }

      // Wait until the user has stopped dragging/scrolling before injecting nodes.
      // Modifying DOM nodes while Embla is actively moving requires a reInit
      // which instantly kills the drag momentum, causing a perceived "stutter".
      while (this._refCarousel.value?.isDragging()) {
        await new Promise<void>((resolve) => new Timer().start(0.05, resolve));
      }

      const sortedOlder = sortItems(uniqueOlder);
      const toPrepend = sortedOlder.slice(-chunkSize);
      const prependedCount = toPrepend.length;

      this._items = [...toPrepend, ...this._items];
      this._queryResults = new QueryResults({ results: this._items });
      this._hasNewer = true;

      const maxBufferSize = chunkSize * 15;
      if (this._items.length > maxBufferSize) {
        this._items = this._items.slice(0, maxBufferSize);
      }

      const previousIndex = this._previousSelectedIndex ?? 0;
      const adjustedIndex = previousIndex + prependedCount;
      this._previousSelectedIndex = adjustedIndex;
      this._targetSlideIndex = adjustedIndex;

      this._thumbnails = this._renderThumbnails();
      this.requestUpdate();

      await this.updateComplete;
      if (this._refCarousel.value) {
        this._refCarousel.value.scrollToSelected(true);
      }
      this._targetSlideIndex = null;
    } catch (e) {
      errorToConsole(e);
    } finally {
      this._isLoadingChunk = false;
    }
  }

  private async _loadNewerChunk(chunkSize: number): Promise<void> {
    if (this._isLoadingChunk || !this._items.length || !this._hasNewer) {
      return;
    }

    const view = this.viewManagerEpoch?.manager.getView();
    if (!this.cameraManager || !this.foldersManager || !view) {
      return;
    }

    const cameraForQuery = view.camera ?? undefined;
    const mediaItems = cameraForQuery
      ? this._items.filter(
          (it) =>
            ViewItemClassifier.isMedia(it) &&
            !ViewItemClassifier.isRecording(it) &&
            it.getCameraID() === cameraForQuery,
        )
      : this._items.filter(
          (it) => ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
        );

    const newestItem = mediaItems[mediaItems.length - 1];
    const newestTime =
      newestItem && ViewItemClassifier.isMedia(newestItem)
        ? newestItem.getStartTime()
        : null;
    if (!newestTime) {
      return;
    }

    this._isLoadingChunk = true;
    try {
      const dummyConditionStateManager: ConditionStateManagerReadonlyInterface = {
        getState: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      };
      const runner = new UnifiedQueryRunner(
        this.cameraManager,
        this.foldersManager,
        this.conditionStateManager ?? dummyConditionStateManager,
      );

      let baseQuery = view.query;
      if (baseQuery && cameraForQuery) {
        baseQuery = UnifiedQueryTransformer.filterByCamera(baseQuery, cameraForQuery);
      }
      baseQuery = this._getNonRecordingQuery(baseQuery, cameraForQuery);
      if (!baseQuery || !baseQuery.hasNodes()) {
        return;
      }

      const newerQuery = UnifiedQueryTransformer.stripTimeRange(
        UnifiedQueryTransformer.stripLimits(baseQuery),
      );

      const chunkHours = this.config?.chunk_hours ?? 24;
      let rawItems: ViewItem[] = [];
      let currentStart = new Date(newestTime.getTime() + 1);
      const now = new Date();
      let attempts = 0;
      const maxAttempts = 7;

      while (rawItems.length === 0 && currentStart < now && attempts < maxAttempts) {
        attempts++;
        const currentEnd = new Date(
          currentStart.getTime() + chunkHours * 60 * 60 * 1000,
        );
        const endToUse = currentEnd > now ? now : currentEnd;

        const loopQuery = UnifiedQueryTransformer.rebuildQuery(newerQuery, {
          start: currentStart,
          end: endToUse,
        });

        let items = await runner.execute(loopQuery, { useCache: true });
        items = items.filter((it) => !ViewItemClassifier.isRecording(it));
        if (items.length > 0) {
          rawItems = items;
        } else {
          currentStart = new Date(currentEnd.getTime() + 1);
        }
      }

      const currentIds = new Set(this._items.map((it) => it.getID()));
      const uniqueNewer = rawItems.filter((it) => !currentIds.has(it.getID()));

      if (!uniqueNewer.length) {
        this._hasNewer = false;
        return;
      }

      const sortedNewer = sortItems(uniqueNewer);
      const toAppend = sortedNewer.slice(0, chunkSize);

      // Wait until the user has stopped dragging/scrolling before injecting nodes.
      while (this._refCarousel.value?.isDragging()) {
        await new Promise<void>((resolve) => new Timer().start(0.05, resolve));
      }

      this._items = [...this._items, ...toAppend];
      this._queryResults = new QueryResults({ results: this._items });
      this._hasOlder = true;
      // Depending on the backend, we might not get exactly chunkSize items,
      // but as long as we get *some* we consider there might be newer ones.
      this._hasNewer = toAppend.length >= 1;

      const maxBufferSize = chunkSize * 15;
      let prunedFromStart = 0;
      if (this._items.length > maxBufferSize) {
        prunedFromStart = this._items.length - maxBufferSize;
        this._items = this._items.slice(prunedFromStart);
      }

      const previousSlide =
        this._previousSelectedIndex ??
        Math.max(0, this._items.length + prunedFromStart - toAppend.length - 1);
      const adjustedIndex = Math.max(0, previousSlide - prunedFromStart);
      this._previousSelectedIndex = adjustedIndex;
      if (prunedFromStart > 0) {
        this._targetSlideIndex = adjustedIndex;
      }

      this._thumbnails = this._renderThumbnails();
      this.requestUpdate();

      if (prunedFromStart > 0) {
        await this.updateComplete;
        if (this._refCarousel.value) {
          this._refCarousel.value.scrollToSelected(true);
        }
        this._targetSlideIndex = null;
      }
    } catch (e) {
      errorToConsole(e);
    } finally {
      this._isLoadingChunk = false;
    }
  }

  private async _loadChunk(
    chunk: DateRange,
    targetSlide: 'start' | 'end' | number | null = null,
  ): Promise<void> {
    const view = this.viewManagerEpoch?.manager.getView();
    if (!this.cameraManager || !this.foldersManager || !view || this._isLoadingChunk) {
      return;
    }

    this._isLoadingChunk = true;

    try {
      const dummyConditionStateManager: ConditionStateManagerReadonlyInterface = {
        getState: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      };
      const runner = new UnifiedQueryRunner(
        this.cameraManager,
        this.foldersManager,
        this.conditionStateManager ?? dummyConditionStateManager,
      );

      const isFolderView = !!view.query?.hasFolderQueries();
      const cameraForQuery = view.camera ?? undefined;
      if (isFolderView) {
        const allResults = view.queryResults?.getResults() ?? [];
        this._items = cameraForQuery
          ? allResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) &&
                !ViewItemClassifier.isRecording(it) &&
                it.getCameraID() === cameraForQuery,
            )
          : allResults.filter(
              (it) =>
                ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
            );
        this._query = view.query ?? null;
        this._queryResults = view.queryResults ?? null;
        this._currentChunk = chunk;
        this._thumbnails = this._renderThumbnails();
        this.requestUpdate();
        return;
      }

      let baseQuery = view.query;
      if (baseQuery && cameraForQuery) {
        baseQuery = UnifiedQueryTransformer.filterByCamera(baseQuery, cameraForQuery);
      }
      baseQuery = this._getNonRecordingQuery(baseQuery, cameraForQuery);

      if (!baseQuery || !baseQuery.hasNodes()) {
        this._items = [];
        this._query = null;
        this._queryResults = null;
        this._currentChunk = chunk;
        this._thumbnails = [];
        this.requestUpdate();
        return;
      }

      const chunkHours = this.config?.chunk_hours ?? 24;
      let searchChunk = chunk;
      let chunkQuery = UnifiedQueryTransformer.rebuildQuery(
        UnifiedQueryTransformer.stripLimits(baseQuery),
        {
          start: searchChunk.start,
          end: searchChunk.end,
        },
      );

      let items = (await runner.execute(chunkQuery, { useCache: true })).filter(
        (it) => !ViewItemClassifier.isRecording(it),
      );
      let attempts = 0;
      const maxAttempts = 7;

      if (targetSlide === 'end' || (!targetSlide && items.length === 0)) {
        while (items.length === 0 && attempts < maxAttempts) {
          attempts++;
          const prevChunkEnd = new Date(searchChunk.start.getTime() - 1);
          searchChunk = convertRangeToCacheFriendlyTimes(
            { start: prevChunkEnd, end: prevChunkEnd },
            { chunkHours },
          );
          const nextQuery = UnifiedQueryTransformer.rebuildQuery(
            UnifiedQueryTransformer.stripLimits(baseQuery),
            {
              start: searchChunk.start,
              end: searchChunk.end,
            },
          );
          items = (await runner.execute(nextQuery, { useCache: true })).filter(
            (it) => !ViewItemClassifier.isRecording(it),
          );
          if (items.length > 0) {
            chunk = searchChunk;
            chunkQuery = nextQuery;
            break;
          }
        }
      } else if (targetSlide === 'start') {
        const now = new Date();
        while (items.length === 0 && searchChunk.end < now && attempts < maxAttempts) {
          attempts++;
          const nextChunkStart = new Date(searchChunk.end.getTime() + 1);
          searchChunk = convertRangeToCacheFriendlyTimes(
            { start: nextChunkStart, end: nextChunkStart },
            { chunkHours },
          );
          const nextQuery = UnifiedQueryTransformer.rebuildQuery(
            UnifiedQueryTransformer.stripLimits(baseQuery),
            {
              start: searchChunk.start,
              end: searchChunk.end,
            },
          );
          items = (await runner.execute(nextQuery, { useCache: true })).filter(
            (it) => !ViewItemClassifier.isRecording(it),
          );
          if (items.length > 0) {
            chunk = searchChunk;
            chunkQuery = nextQuery;
            break;
          }
        }
      }

      this._items = items;
      this._query = chunkQuery;
      this._queryResults = new QueryResults({ results: items });
      this._currentChunk = chunk;

      if (targetSlide === 'start') {
        this._targetSlideIndex = 0;
      } else if (targetSlide === 'end') {
        this._targetSlideIndex = Math.max(0, items.length - 1);
      } else if (typeof targetSlide === 'number') {
        this._targetSlideIndex = targetSlide;
      } else {
        this._targetSlideIndex = null;
      }

      this._thumbnails = this._renderThumbnails();
      this.requestUpdate();

      await this.updateComplete;
      if (this._refCarousel.value && this._targetSlideIndex !== null) {
        this._previousSelectedIndex = this._targetSlideIndex;
        this._refCarousel.value.scrollToSelected(true);
      }
    } catch (e) {
      errorToConsole(e);
    } finally {
      this._isLoadingChunk = false;
    }
  }

  private async _onCarouselSelect(ev: CustomEvent<CarouselSelected>): Promise<void> {
    if (this._isLoadingChunk || !this._items.length || this._items.length <= 1) {
      return;
    }

    const chunkSize = this.config?.chunk_size;
    if (chunkSize) {
      const slideIndex = ev.detail.slideIndex ?? ev.detail.index;
      const previousIndex = this._previousSelectedIndex;
      this._previousSelectedIndex = slideIndex;
      if (this._refCarousel.value) {
        this._refCarousel.value.selected = slideIndex;
      }

      if (previousIndex === null || previousIndex === slideIndex) {
        return;
      }

      const hasUpFolder = !!getUpFolderItem(
        this.viewManagerEpoch?.manager.getView()?.query,
      );
      const offset = hasUpFolder ? 1 : 0;
      const itemIndex = slideIndex - offset;

      const threshold = Math.max(5, chunkSize - 5);
      const totalItems = this._items.length + offset;
      const isNearStart =
        ev.detail?.canScrollPrev === false ||
        (totalItems > 0 && slideIndex <= 0) ||
        itemIndex <= threshold;
      const isNearEnd =
        ev.detail?.canScrollNext === false ||
        (totalItems > 0 && slideIndex >= totalItems - 1) ||
        itemIndex >= this._items.length - 1 - threshold;

      // Edge triggers
      if (isNearStart && this._hasOlder) {
        await this._loadOlderChunk(chunkSize);
        return;
      } else if (isNearEnd && this._hasNewer) {
        await this._loadNewerChunk(chunkSize);
        return;
      }
      return;
    }

    if (!this._currentChunk) {
      return;
    }

    const chunkHours = this.config?.chunk_hours ?? 24;
    const selectedIndex = ev.detail.index;
    const previousIndex = this._previousSelectedIndex;
    this._previousSelectedIndex = selectedIndex;

    if (previousIndex === null) {
      return;
    }

    const hasUpFolder = !!getUpFolderItem(
      this.viewManagerEpoch?.manager.getView()?.query,
    );
    const offset = hasUpFolder ? 1 : 0;
    const totalItems = this._items.length + offset;

    const isAtStart =
      ev.detail?.canScrollPrev === false ||
      (totalItems > 0 && selectedIndex <= 0) ||
      selectedIndex === 0;
    const isAtEnd =
      ev.detail?.canScrollNext === false ||
      (totalItems > 0 && selectedIndex >= totalItems - 1) ||
      selectedIndex >= this._items.length - 1;

    if (isAtStart && previousIndex > 0) {
      const prevChunkEnd = new Date(this._currentChunk.start.getTime() - 1);
      const prevChunk = convertRangeToCacheFriendlyTimes(
        { start: prevChunkEnd, end: prevChunkEnd },
        { chunkHours },
      );
      await this._loadChunk(prevChunk, 'end');
    } else if (
      isAtEnd &&
      previousIndex < selectedIndex &&
      this._currentChunk.end < new Date()
    ) {
      const nextChunkStart = new Date(this._currentChunk.end.getTime() + 1);
      const nextChunk = convertRangeToCacheFriendlyTimes(
        { start: nextChunkStart, end: nextChunkStart },
        { chunkHours },
      );
      await this._loadChunk(nextChunk, 'start');
    }
  }

  private _getSelectedSlide(items?: ViewItem[]): number | null {
    const view = this.viewManagerEpoch?.manager.getView();
    const isFolderView = !!view?.query?.hasFolderQueries();
    if (isFolderView && !view?.isGrid()) {
      const selectedIndex = view?.queryResults?.getSelectedIndex() ?? null;
      if (selectedIndex === null) {
        return null;
      }
      const hasUpFolder = !!getUpFolderItem(view?.query);
      return hasUpFolder ? selectedIndex + 1 : selectedIndex;
    }

    const selectedMedia = view?.queryResults?.getSelectedResult();
    if (!selectedMedia) {
      return null;
    }
    const targetItems = items ?? this._items;
    const index = targetItems.findIndex(
      (item) =>
        ViewItemClassifier.isMedia(item) && item.getID() === selectedMedia.getID(),
    );
    if (index === -1) {
      return null;
    }
    const hasUpFolder = !!getUpFolderItem(view?.query);
    return hasUpFolder ? index + 1 : index;
  }

  private async _handleMediaClick(item: ViewMedia): Promise<void> {
    const clickedIndex = this._items.findIndex((it) => it.getID() === item.getID());
    if (clickedIndex !== -1) {
      const hasUpFolder = !!getUpFolderItem(
        this.viewManagerEpoch?.manager.getView()?.query,
      );
      this._previousSelectedIndex = clickedIndex + (hasUpFolder ? 1 : 0);
    }

    fireAdvancedCameraCardEvent<ThumbnailMediaSelect>(
      this,
      'thumbnails-carousel:media-select',
      { media: item },
    );
    if (!this.viewManagerEpoch) {
      return;
    }

    const targetTime = item.getStartTime() ?? undefined;
    const view = this.viewManagerEpoch.manager.getView();
    const isGrid = view?.isGrid();
    const cameraID = item.getCameraID();
    const isEvent = ViewItemClassifier.isEvent(item);

    const modifiers: ViewModifier[] = [
      new RemoveContextViewModifier(['timeline']),
      ...(targetTime && (!isEvent || isGrid)
        ? [new MergeContextViewModifier({ mediaViewer: { seek: targetTime } })]
        : [new RemoveContextPropertyViewModifier('mediaViewer', 'seek')]),
    ];

    const sourceResults = (isGrid ? view?.queryResults : null) ?? this._queryResults;
    if (sourceResults) {
      let workingResults = sourceResults.clone();
      if (!workingResults.getResults()?.some((m) => m.getID() === item.getID())) {
        const combined = [...(workingResults.getResults() ?? []), item];
        workingResults = new QueryResults({
          results: combined,
        });
      }
      let newResults = workingResults.selectResultIfFound(
        (result) => result.getID() === item.getID(),
      );

      if (isGrid && targetTime) {
        newResults = await syncGridResultsForTargetTime(newResults, {
          cameraManager: this.cameraManager,
          targetTime,
          selectedCameraID: cameraID ?? undefined,
          selectedItemID: item.getID(),
        });
      }

      void this.viewManagerEpoch.manager.setViewByParameters({
        params: {
          view: 'media',
          queryResults: newResults,
          query: isGrid ? view?.query ?? undefined : this._query ?? undefined,
          ...(cameraID && { camera: cameraID }),
        },
        modifiers,
      });
    } else {
      navigateToMedia(item, {
        viewManagerEpoch: this.viewManagerEpoch,
        modifiers,
      });
    }
  }

  private _renderThumbnail(
    item: ViewItem,
    selected: boolean,
    clickCallback: (item: ViewItem, ev: Event) => void,
    seekTarget?: Date,
    filterReviewed?: boolean,
  ): TemplateResult {
    const classes = {
      embla__slide: true,
      'slide-selected': selected,
    };

    return html` <advanced-camera-card-thumbnail
      class="${classMap(classes)}"
      .cameraManager=${this.cameraManager}
      .hass=${this.hass}
      .filterReviewed=${filterReviewed}
      .item=${item}
      .viewManagerEpoch=${this.viewManagerEpoch}
      .viewItemManager=${this.viewItemManager}
      .seek=${seekTarget &&
      ViewItemClassifier.isMedia(item) &&
      item.includesTime(seekTarget)
        ? seekTarget
        : undefined}
      ?details=${!!this.config?.show_details}
      ?show_favorite_control=${this.config?.show_favorite_control}
      ?show_timeline_control=${this.config?.show_timeline_control}
      ?show_download_control=${this.config?.show_download_control}
      ?show_review_control=${this.config?.show_review_control}
      ?show_info_control=${this.config?.show_info_control}
      @click=${(ev: Event) => clickCallback(item, ev)}
    >
    </advanced-camera-card-thumbnail>`;
  }

  private _renderThumbnails(): unknown {
    const view = this.viewManagerEpoch?.manager.getView();
    const upFolderItem = getUpFolderItem(view?.query);

    const isFolderView = !!view?.query?.hasFolderQueries();
    const cameraForQuery = view?.camera ?? undefined;
    const rawItems = isFolderView ? view?.queryResults?.getResults() ?? [] : this._items;
    const items = cameraForQuery
      ? rawItems.filter(
          (it) =>
            ViewItemClassifier.isMedia(it) &&
            !ViewItemClassifier.isRecording(it) &&
            it.getCameraID() === cameraForQuery,
        )
      : rawItems.filter(
          (it) => ViewItemClassifier.isMedia(it) && !ViewItemClassifier.isRecording(it),
        );

    if (!upFolderItem && items.length === 0) {
      return null;
    }

    const selectedIndex = this._getSelectedSlide(items);
    const offset = upFolderItem ? 1 : 0;

    return html`
      ${upFolderItem
        ? this._renderThumbnail(
            upFolderItem,
            selectedIndex === 0,
            (_item: ViewItem, ev: Event) => {
              stopEventFromActivatingCardWideActions(ev);
              navigateUp(this._getFolderNavOptions());
            },
          )
        : ''}
      ${repeat(
        items,
        (item) => item.getID(),
        (item, index) => {
          const clickHandler = (item: ViewItem, ev: Event) => {
            stopEventFromActivatingCardWideActions(ev);
            if (ViewItemClassifier.isMedia(item)) {
              void this._handleMediaClick(item);
            } else if (ViewItemClassifier.isFolder(item)) {
              navigateToFolder(item, this._getFolderNavOptions());
            }
          };
          return this._renderThumbnail(
            item,
            selectedIndex === index + offset,
            clickHandler,
            view?.context?.mediaViewer?.seek,
            getReviewedQueryFilterFromQuery(view?.query, item),
          );
        },
      )}
    `;
  }

  private _getDirection(): CarouselDirection | null {
    if (this.config?.mode === 'left' || this.config?.mode === 'right') {
      return 'vertical';
    } else if (this.config?.mode === 'above' || this.config?.mode === 'below') {
      return 'horizontal';
    }
    return null;
  }

  private _getScrollSlide(): number | null {
    if (this._targetSlideIndex !== null) {
      return this._targetSlideIndex;
    }
    const view = this.viewManagerEpoch?.manager.getView();
    const hasUpFolder = !!getUpFolderItem(view?.query);
    if (this.config?.chunk_size && this._previousSelectedIndex !== null) {
      const totalSlides = this._items.length + (hasUpFolder ? 1 : 0);
      if (totalSlides > 0) {
        return Math.min(this._previousSelectedIndex, totalSlides - 1);
      }
    }
    const selectedSlide = this._getSelectedSlide();
    if (selectedSlide !== null) {
      return selectedSlide;
    }
    const isFolderView = !!view?.query?.hasFolderQueries();
    const resultsCount = isFolderView
      ? view?.queryResults?.getResultsCount() ?? 0
      : this._items.length;
    if (resultsCount > 0) {
      return hasUpFolder ? resultsCount : resultsCount - 1;
    }
    if (hasUpFolder) {
      return 0;
    }
    return null;
  }

  protected render(): TemplateResult | void {
    if (!this._thumbnails || !this.config?.mode || this.config.mode === 'none') {
      return;
    }

    return html`<advanced-camera-card-carousel
      ${ref(this._refCarousel)}
      @advanced-camera-card:carousel:select=${this._onCarouselSelect}
      class="${classMap({ fade: this.fadeThumbnails })}"
      direction=${this._getDirection() ?? 'horizontal'}
      .selected=${this._getScrollSlide() ?? 0}
      .dragFree=${true}
    >
      ${this._thumbnails}
    </advanced-camera-card-carousel> `;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(thumbnailCarouselStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-thumbnail-carousel': AdvancedCameraCardThumbnailCarousel;
  }
}

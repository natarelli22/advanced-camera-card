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

import type { CameraManager } from '../camera-manager/manager.js';
import type { DateRange } from '../camera-manager/range.js';
import { convertRangeToCacheFriendlyTimes } from '../camera-manager/utils/range-to-cache-friendly.js';
import type { FoldersManager } from '../card-controller/folders/manager.js';
import type { ViewItemManager } from '../card-controller/view/item-manager.js';
import { RemoveContextViewModifier } from '../card-controller/view/modifiers/remove-context.js';
import type { ViewManagerEpoch } from '../card-controller/view/types.js';
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
import thumbnailCarouselStyle from '../scss/thumbnail-carousel.scss?inline';
import { stopEventFromActivatingCardWideActions } from '../utils/action.js';
import { errorToConsole } from '../utils/basic.js';
import type {
  CarouselDirection,
  CarouselSelected,
} from '../utils/embla/carousel-controller.js';
import { fireAdvancedCameraCardEvent } from '../utils/fire-advanced-camera-card-event.js';
import { ViewItemClassifier } from '../view/item-classifier.js';
import type { ViewItem, ViewMedia } from '../view/item.js';
import { QueryResults } from '../view/query-results.js';
import { UnifiedQueryBuilder } from '../view/unified-query-builder.js';
import { UnifiedQueryRunner } from '../view/unified-query-runner.js';
import { UnifiedQueryTransformer } from '../view/unified-query-transformer.js';
import type { UnifiedQuery } from '../view/unified-query.js';
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
  private _thumbnails: TemplateResult[] = [];
  private _builder: UnifiedQueryBuilder | null = null;

  private _items: ViewItem[] = [];
  private _query: UnifiedQuery | null = null;
  private _queryResults: QueryResults | null = null;
  private _currentChunk: DateRange | null = null;
  private _isLoadingChunk = false;
  private _targetSlideIndex: number | null = null;
  private _lastCameraKey: string | null = null;
  private _previousSelectedIndex: number | null = null;

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

    const cameraKey = view.isGrid() ? 'grid' : view.camera ?? 'default';
    if (
      this._currentChunk &&
      this._lastCameraKey === cameraKey &&
      refTime >= this._currentChunk.start &&
      refTime <= this._currentChunk.end
    ) {
      this._thumbnails = this._renderThumbnails();
      return;
    }

    if (
      !this._items.length &&
      view.queryResults &&
      view.queryResults.getResultsCount() > 0
    ) {
      this._items = view.queryResults.getResults() ?? [];
      this._thumbnails = this._renderThumbnails();
    }

    this._lastCameraKey = cameraKey;
    const chunk = convertRangeToCacheFriendlyTimes(
      { start: refTime, end: refTime },
      { chunkHours },
    );
    void this._loadChunk(chunk);
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
      if (isFolderView) {
        this._items = view.queryResults?.getResults() ?? [];
        this._query = view.query ?? null;
        this._queryResults = view.queryResults ?? null;
        this._currentChunk = chunk;
        this._thumbnails = this._renderThumbnails();
        this.requestUpdate();
        return;
      }

      let baseQuery = view.query;
      if (!baseQuery || !baseQuery.hasNodes()) {
        const cameraForQuery = view.isGrid() ? undefined : view.camera ?? undefined;
        baseQuery = this._builder?.buildDefaultCameraQuery(cameraForQuery) ?? null;
      }

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

      let items = await runner.execute(chunkQuery, { useCache: true });
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
          items = await runner.execute(nextQuery, { useCache: true });
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
          items = await runner.execute(nextQuery, { useCache: true });
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
    if (
      this._isLoadingChunk ||
      !this._currentChunk ||
      !this._items.length ||
      this._items.length <= 1
    ) {
      return;
    }

    const chunkHours = this.config?.chunk_hours ?? 24;
    const selectedIndex = ev.detail.index;
    const previousIndex = this._previousSelectedIndex;
    this._previousSelectedIndex = selectedIndex;

    if (previousIndex === null) {
      return;
    }

    if (selectedIndex === 0 && previousIndex > 0) {
      const prevChunkEnd = new Date(this._currentChunk.start.getTime() - 1);
      const prevChunk = convertRangeToCacheFriendlyTimes(
        { start: prevChunkEnd, end: prevChunkEnd },
        { chunkHours },
      );
      await this._loadChunk(prevChunk, 'end');
    } else if (
      selectedIndex >= this._items.length - 1 &&
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

  private _getSelectedSlide(): number | null {
    const view = this.viewManagerEpoch?.manager.getView();
    const isFolderView = !!view?.query?.hasFolderQueries();
    if (isFolderView) {
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
    const index = this._items.findIndex(
      (item) =>
        ViewItemClassifier.isMedia(item) && item.getID() === selectedMedia.getID(),
    );
    if (index === -1) {
      return null;
    }
    const hasUpFolder = !!getUpFolderItem(view?.query);
    return hasUpFolder ? index + 1 : index;
  }

  private _handleMediaClick(item: ViewMedia): void {
    fireAdvancedCameraCardEvent<ThumbnailMediaSelect>(
      this,
      'thumbnails-carousel:media-select',
      { media: item },
    );
    if (this.viewManagerEpoch) {
      if (this._queryResults) {
        const newResults = this._queryResults
          .clone()
          .selectResultIfFound((result) => result.getID() === item.getID());
        const cameraID = item.getCameraID();
        void this.viewManagerEpoch.manager.setViewByParameters({
          params: {
            view: 'media',
            queryResults: newResults,
            query: this._query ?? undefined,
            ...(cameraID && { camera: cameraID }),
          },
          modifiers: [new RemoveContextViewModifier(['timeline', 'mediaViewer'])],
        });
      } else {
        navigateToMedia(item, {
          viewManagerEpoch: this.viewManagerEpoch,
          modifiers: [new RemoveContextViewModifier(['timeline', 'mediaViewer'])],
        });
      }
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

  private _renderThumbnails(): TemplateResult[] {
    const view = this.viewManagerEpoch?.manager.getView();
    const upFolderItem = getUpFolderItem(view?.query);
    const thumbnails: TemplateResult[] = upFolderItem
      ? [
          this._renderThumbnail(upFolderItem, false, (_item: ViewItem, ev: Event) => {
            stopEventFromActivatingCardWideActions(ev);
            navigateUp(this._getFolderNavOptions());
          }),
        ]
      : [];

    const isFolderView = !!view?.query?.hasFolderQueries();
    const items = isFolderView ? view?.queryResults?.getResults() ?? [] : this._items;
    const selectedIndex = this._getSelectedSlide();

    for (const item of items) {
      const clickHandler = (item: ViewItem, ev: Event) => {
        stopEventFromActivatingCardWideActions(ev);
        if (ViewItemClassifier.isMedia(item)) {
          this._handleMediaClick(item);
        } else if (ViewItemClassifier.isFolder(item)) {
          navigateToFolder(item, this._getFolderNavOptions());
        }
      };
      thumbnails.push(
        this._renderThumbnail(
          item,
          selectedIndex === thumbnails.length,
          clickHandler,
          view?.context?.mediaViewer?.seek,
          getReviewedQueryFilterFromQuery(view?.query, item),
        ),
      );
    }

    return thumbnails;
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
    const selectedSlide = this._getSelectedSlide();
    if (selectedSlide !== null) {
      return selectedSlide;
    }
    if (this._targetSlideIndex !== null) {
      return this._targetSlideIndex;
    }
    const view = this.viewManagerEpoch?.manager.getView();
    const isFolderView = !!view?.query?.hasFolderQueries();
    const resultsCount = isFolderView
      ? view?.queryResults?.getResultsCount() ?? 0
      : this._items.length;
    const hasUpFolder = !!getUpFolderItem(view?.query);
    if (resultsCount > 0) {
      return hasUpFolder ? resultsCount : resultsCount - 1;
    }
    if (hasUpFolder) {
      return 0;
    }
    return null;
  }

  protected render(): TemplateResult | void {
    if (!this._thumbnails.length || !this.config?.mode || this.config.mode === 'none') {
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

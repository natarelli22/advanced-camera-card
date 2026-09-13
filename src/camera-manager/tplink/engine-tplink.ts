import { add, endOfDay, parse, startOfDay } from 'date-fns';
import { orderBy } from 'lodash-es';

import type { HASSManagerReadonlyInterface } from '../../card-controller/hass/types';
import type { CameraConfig } from '../../config/schema/cameras';
import { getViewMediaFromBrowseMediaArray } from '../../ha/browse-media/browse-media-to-view-media';
import { sortMostRecentFirst } from '../../ha/browse-media/sort';
import {
  BROWSE_MEDIA_CACHE_SECONDS,
  BrowseMediaCache,
  MEDIA_CLASS_VIDEO,
  type BrowseMedia,
  type BrowseMediaMetadata,
  type RichBrowseMedia,
} from '../../ha/browse-media/types';
import type { BrowseMediaWalker } from '../../ha/browse-media/walker';
import { isMediaWithinDates } from '../../ha/browse-media/within-dates';
import type { EntityRegistryManager } from '../../ha/registry/entity/types';
import type { ResolvedMediaCache } from '../../ha/resolved-media';
import type { HomeAssistant } from '../../ha/types';
import { hasUnsupportedFilters, QuerySource } from '../../query-source.js';
import { allPromises, formatDate, isValidDate } from '../../utils/basic';
import type { ViewMedia } from '../../view/item';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import type { Camera } from '../camera';
import { CAMERA_MANAGER_ENGINE_EVENT_LIMIT_DEFAULT } from '../engine';
import type { CameraManagerReadOnlyConfigStore } from '../store';
import {
  Engine,
  QueryResultsType,
  QueryType,
  type CameraEventCallback,
  type CameraManagerCameraMetadata,
  type CameraManagerRequestCache,
  type CameraQuery,
  type EngineOptions,
  type EventQuery,
  type EventQueryResults,
  type EventQueryResultsMap,
  type MediaMetadataQuery,
  type MediaMetadataQueryResults,
  type MediaMetadataQueryResultsMap,
  type PartialRecordingQuery,
  type QueryReturnType,
  type RecordingQuery,
  type RecordingQueryResultsMap,
} from '../types';
import { TPLinkCamera } from './camera';
import {
  TPLinkQueryResultsClassifier,
  type BrowseMediaTPLinkCameraMetadata,
  type TPLinkEventQueryResults,
  type TPLinkRecordingQueryResults,
} from './types';

export class TPLinkCameraManagerEngine extends BrowseMediaCameraManagerEngine {
  private _camerasCache = new BrowseMediaCache<BrowseMediaTPLinkCameraMetadata>();
  private _cache = new BrowseMediaCache<BrowseMediaMetadata>();

  public constructor(
    entityRegistryManager: EntityRegistryManager,
    hassManager: HASSManagerReadonlyInterface,
    browseMediaManager: BrowseMediaWalker,
    resolvedMediaCache: ResolvedMediaCache,
    requestCache: CameraManagerRequestCache,
    eventCallback?: CameraEventCallback,
  ) {
    super(
      entityRegistryManager,
      hassManager,
      browseMediaManager,
      resolvedMediaCache,
      requestCache,
      eventCallback,
    );
  }

  public getEngineType(): Engine {
    return Engine.TPLink;
  }

  private _tplinkCameraMetadataGenerator(
    media: BrowseMedia,
  ): BrowseMediaTPLinkCameraMetadata {
    const entryMatch = media.media_content_id.match(/entry=(?<entry>[^&]+)/);
    const childMatch = media.media_content_id.match(/childID=(?<childID>[^&]+)/);
    const cameraMatch = media.media_content_id.match(/camera=(?<camera>[^&]+)/);
    return {
      ...(entryMatch?.groups?.entry && {
        configEntryID: decodeURIComponent(entryMatch.groups.entry),
      }),
      ...(childMatch?.groups?.childID && {
        childID: decodeURIComponent(childMatch.groups.childID),
      }),
      ...(cameraMatch?.groups?.camera && {
        cameraName: decodeURIComponent(cameraMatch.groups.camera),
        camera: decodeURIComponent(cameraMatch.groups.camera),
      }),
      title: media.title,
    };
  }

  private _tplinkDirectoryMetadataGenerator(
    cameraID: string,
    media: BrowseMedia,
  ): BrowseMediaMetadata | null {
    // tapo_control date directories typically use YYYYMMDD, YYYY-MM-DD, YYYY_MM_DD, DD/MM/YYYY, or DD-MM-YYYY
    let parsedDate = parse(media.title, 'yyyyMMdd', new Date());
    if (!isValidDate(parsedDate)) {
      parsedDate = parse(media.title, 'yyyy-MM-dd', new Date());
    }
    if (!isValidDate(parsedDate)) {
      parsedDate = parse(media.title, 'yyyy_MM_dd', new Date());
    }
    if (!isValidDate(parsedDate)) {
      parsedDate = parse(media.title, 'dd/MM/yyyy', new Date());
    }
    if (!isValidDate(parsedDate)) {
      parsedDate = parse(media.title, 'dd-MM-yyyy', new Date());
    }
    if (!isValidDate(parsedDate)) {
      const dateMatch =
        media.title.match(/(?<y>\d{4})[-_](?<m>\d{2})[-_](?<d>\d{2})/) ||
        media.title.match(/(?<d>\d{2})[/-](?<m>\d{2})[/-](?<y>\d{4})/) ||
        media.title.match(/(?<y>\d{4})(?<m>\d{2})(?<d>\d{2})/) ||
        media.media_content_id.match(/date=(?<date>\d{8}|\d{4}[-_]\d{2}[-_]\d{2})/);
      if (dateMatch) {
        if (dateMatch.groups?.d && dateMatch.groups?.m && dateMatch.groups?.y) {
          parsedDate = parse(
            `${dateMatch.groups.y}-${dateMatch.groups.m}-${dateMatch.groups.d}`,
            'yyyy-MM-dd',
            new Date(),
          );
        } else {
          const rawDate = (dateMatch.groups?.date || dateMatch[0] || '').replace(
            /_/g,
            '-',
          );
          if (rawDate.length === 8 && !rawDate.includes('-')) {
            parsedDate = parse(rawDate, 'yyyyMMdd', new Date());
          } else {
            parsedDate = parse(rawDate, 'yyyy-MM-dd', new Date());
          }
        }
      }
    }

    return isValidDate(parsedDate)
      ? {
          cameraID: cameraID,
          startDate: startOfDay(parsedDate),
          endDate: endOfDay(parsedDate),
        }
      : null;
  }

  private _tplinkFileMetadataGenerator(
    cameraID: string,
    media: BrowseMedia,
    parent?: RichBrowseMedia<BrowseMediaMetadata>,
  ): BrowseMediaMetadata | null {
    // tapo_control returns leaf items with media_class: MediaClass.DIRECTORY
    // even though can_play is true and media_content_type is MediaType.VIDEO.
    // Ensure media_class is set to MEDIA_CLASS_VIDEO so BrowseMediaViewItemFactory
    // creates a BrowseMediaEventViewMedia (clip).
    if (
      media.media_class !== MEDIA_CLASS_VIDEO &&
      (media.can_play ||
        media.media_content_type === 'video' ||
        media.title.toLowerCase().endsWith('.mp4'))
    ) {
      media.media_class = MEDIA_CLASS_VIDEO;
      media.can_expand = false;
    }

    if (media.media_class !== MEDIA_CLASS_VIDEO) {
      return null;
    }

    // 1) From URL query params: startDate and endDate are unix epoch seconds.
    const startMatch = media.media_content_id.match(/startDate=(?<start>\d+)/);
    const endMatch = media.media_content_id.match(/endDate=(?<end>\d+)/);

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (startMatch?.groups?.start) {
      const startSeconds = Number(startMatch.groups.start);
      if (startSeconds > 0) {
        startDate = new Date(startSeconds * 1000);
      }
    }
    if (endMatch?.groups?.end) {
      const endSeconds = Number(endMatch.groups.end);
      if (endSeconds > 0) {
        endDate = new Date(endSeconds * 1000);
      }
    }

    // 2) From unix timestamp range in content_id or title: e.g. 1726097713-1726097740
    if (!startDate || !isValidDate(startDate)) {
      const unixRangeMatch = `${media.media_content_id} ${media.title}`.match(
        /(?<start>\d{10})[-_](?<end>\d{10})/,
      );
      if (unixRangeMatch?.groups) {
        const s = Number(unixRangeMatch.groups.start);
        const e = Number(unixRangeMatch.groups.end);
        if (s > 0) {
          startDate = new Date(s * 1000);
        }
        if (e > s) {
          endDate = new Date(e * 1000);
        }
      }
    }

    // 3) From full datetime patterns in content_id or title:
    // e.g. 2026-09-11_23-35-13_0_1268dab1c2.mp4 or 2026-09-12-14-39-55
    if (!startDate || !isValidDate(startDate)) {
      const fullDateRegex =
        /(?<year>\d{4})[-_](?<month>\d{2})[-_](?<day>\d{2})[-_]+(?<hour>\d{2})[-_](?<min>\d{2})[-_](?<sec>\d{2})/g;
      const combined = `${media.media_content_id} ${media.title}`;
      const matches = [...combined.matchAll(fullDateRegex)];
      if (matches.length > 0 && matches[0]?.groups) {
        const g1 = matches[0].groups;
        const parsed = new Date(
          Number(g1.year),
          Number(g1.month) - 1,
          Number(g1.day),
          Number(g1.hour),
          Number(g1.min),
          Number(g1.sec),
        );
        if (isValidDate(parsed)) {
          startDate = parsed;
        }
        // Only consider a second match as endDate if its timestamp is strictly after start
        for (let i = 1; i < matches.length; i++) {
          const gi = matches[i].groups;
          if (!gi) {
            continue;
          }
          const parsedEnd = new Date(
            Number(gi.year),
            Number(gi.month) - 1,
            Number(gi.day),
            Number(gi.hour),
            Number(gi.min),
            Number(gi.sec),
          );
          if (isValidDate(parsedEnd) && parsedEnd.getTime() > parsed.getTime()) {
            endDate = parsedEnd;
            break;
          }
        }
      }
    }

    // Determine base date for fallback parsing of times (e.g. HH:mm:ss in title)
    const baseDate =
      (startDate && isValidDate(startDate) ? startDate : null) ??
      parent?._metadata?.startDate ??
      (() => {
        const dateMatch =
          media.media_content_id.match(/date=(?<date>\d{4}[-_]\d{2}[-_]\d{2})/) ||
          media.title.match(/(?<date>\d{4}[-_]\d{2}[-_]\d{2})/);
        if (dateMatch?.groups?.date) {
          const d = parse(
            dateMatch.groups.date.replace(/_/g, '-'),
            'yyyy-MM-dd',
            new Date(),
          );
          if (isValidDate(d)) {
            return d;
          }
        }
        return null;
      })();

    // 4) Fallback from media.title of the form: "HH:mm:ss - HH:mm:ss" or "HH:mm:ss"
    // Use regex to split range without tearing apart hyphens in dates or times
    const rangeParts = media.title.split(/\s+[-–\u2014]\s+/);
    if (!startDate || !isValidDate(startDate)) {
      if (baseDate) {
        let parsedStart = parse(rangeParts[0], 'HH:mm:ss', baseDate);
        if (!isValidDate(parsedStart)) {
          parsedStart = parse(rangeParts[0], 'HH-mm-ss', baseDate);
        }
        if (isValidDate(parsedStart)) {
          startDate = parsedStart;
        }
      }
    }

    if (!startDate || !isValidDate(startDate)) {
      return null;
    }

    if (!endDate || !isValidDate(endDate)) {
      if (rangeParts.length > 1 && baseDate) {
        let parsedEnd = parse(rangeParts[1], 'HH:mm:ss', baseDate);
        if (!isValidDate(parsedEnd)) {
          parsedEnd = parse(rangeParts[1], 'HH-mm-ss', baseDate);
        }
        if (isValidDate(parsedEnd) && parsedEnd.getTime() > startDate.getTime()) {
          endDate = parsedEnd;
        }
      }
    }

    // Video clips must always have a positive duration (> 0). If endDate is
    // missing, invalid, or <= startDate, fallback to duration from query param or 30s default.
    if (!endDate || !isValidDate(endDate) || endDate.getTime() <= startDate.getTime()) {
      const durationMatch = media.media_content_id.match(/duration=(?<dur>\d+)/);
      const durSec = durationMatch?.groups?.dur ? Number(durationMatch.groups.dur) : 30;
      endDate = add(startDate, { seconds: durSec > 0 ? durSec : 30 });
    }

    let thumbnail = media.thumbnail;
    if (!thumbnail && media.media_content_id.includes('/videos/')) {
      thumbnail = media.media_content_id
        .replace('/videos/', '/thumbs/')
        .replace(/\.mp4(\?.*)?$/i, '.jpg$1');
    }

    return {
      cameraID: cameraID,
      startDate: startDate,
      endDate: endDate,
      ...(thumbnail && { thumbnailOverride: thumbnail }),
    };
  }

  public async createCamera(cameraConfig: CameraConfig): Promise<Camera> {
    const camera = new TPLinkCamera(cameraConfig, this, {
      eventCallback: this._eventCallback,
    });
    return await camera.initialize({
      hassManager: this._hassManager,
      entityRegistryManager: this._entityRegistryManager,
    });
  }

  private async _getMatchingDirectories(
    hass: HomeAssistant,
    camera: TPLinkCamera,
    matchOptions?: {
      start?: Date;
      end?: Date;
    } | null,
    engineOptions?: EngineOptions,
  ): Promise<RichBrowseMedia<BrowseMediaMetadata>[] | null> {
    const entity = camera.getEntity();
    const configID = entity?.config_entry_id;
    const cameraID = camera.getID();
    const cameraTitle = camera.getConfig().title;
    const entityID = entity?.entity_id ?? camera.getConfig().camera_entity;

    const normalizeString = (s?: string | null): string =>
      (s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

    const extractTokens = (s?: string | null): string[] =>
      (s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/^camera\./, '')
        .replace(/(_hd_stream|_sd_stream|_stream|_hd|_sd)$/, '')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 0 && !['camera', 'hd', 'sd', 'stream'].includes(t));

    const targetCores = new Set(
      [
        normalizeString(cameraID),
        normalizeString(cameraTitle),
        normalizeString(entityID),
        normalizeString(entityID?.replace(/^camera\./, '')),
        normalizeString(
          entityID
            ?.replace(/^camera\./, '')
            ?.replace(/_hd_stream|_sd_stream|_stream/, ''),
        ),
        normalizeString(cameraTitle?.replace(/\s*(hd|sd)?\s*stream/i, '')),
      ].filter((s) => s.length > 0),
    );

    const targetTokens = new Set([
      ...extractTokens(cameraID),
      ...extractTokens(cameraTitle),
      ...extractTokens(entityID),
    ]);

    const isCameraMatch = (
      media: RichBrowseMedia<BrowseMediaTPLinkCameraMetadata>,
    ): boolean => {
      // 1. Strongest match: matching configEntryID if both are present
      if (configID && media._metadata?.configEntryID === configID) {
        return true;
      }

      const mediaNames = [
        media._metadata?.cameraName,
        media._metadata?.title,
        media.title,
      ].filter(Boolean) as string[];

      // 2. Exact match on normalized name cores
      for (const m of mediaNames) {
        const mCore = normalizeString(m);
        if (mCore.length > 0 && targetCores.has(mCore)) {
          return true;
        }
      }

      // 3. Token overlap match
      for (const m of mediaNames) {
        const mTokens = extractTokens(m);
        if (mTokens.length > 0) {
          const matchingTokens = mTokens.filter((t) => targetTokens.has(t));
          if (matchingTokens.length === mTokens.length && matchingTokens.length > 0) {
            return true;
          }
        }
      }

      // 4. Safe substring containment (only if length >= 3 to avoid false positives)
      for (const m of mediaNames) {
        const mCore = normalizeString(m);
        if (mCore.length >= 3) {
          for (const tCore of targetCores) {
            if (tCore.length >= 3 && (tCore.includes(mCore) || mCore.includes(tCore))) {
              return true;
            }
          }
        }
      }

      return false;
    };

    const storagePath = camera.getStoragePath(hass);

    if (storagePath && storagePath.startsWith('/media')) {
      const relPath = storagePath.replace(/^\/media\/?/, '').replace(/\/+$/, '');
      const targetUri = relPath
        ? `media-source://media_source/local/${relPath}`
        : 'media-source://media_source/local';

      // 1. Browse the Cold storage path directly (without calling media-source://tapo_control)
      const rootContent = await this._browseMediaWalker.walk(
        hass,
        [
          {
            targets: [targetUri],
          },
        ],
        {
          ...(engineOptions?.useCache !== false && { cache: this._cache }),
        },
      );

      if (rootContent?.length) {
        // Check if rootContent contains camera subfolders (if storagePath was a shared parent)
        const matchedCameraFolders = rootContent.filter(
          (c) =>
            c.can_expand &&
            c.title.toLowerCase() !== 'videos' &&
            c.title.toLowerCase() !== 'thumbs' &&
            !/^\d{4}[-_]\d{2}[-_]\d{2}$/.test(c.title) &&
            !/^\d{8}$/.test(c.title) &&
            isCameraMatch({
              ...c,
              _metadata: { cameraName: c.title, title: c.title },
            } as RichBrowseMedia<BrowseMediaTPLinkCameraMetadata>),
        );

        let cameraFoldersContent = rootContent;
        let cameraFolderUris = [targetUri];

        if (matchedCameraFolders.length > 0) {
          cameraFolderUris = matchedCameraFolders.map((f) => f.media_content_id);
          cameraFoldersContent = await this._browseMediaWalker.walk(
            hass,
            [
              {
                targets: cameraFolderUris,
              },
            ],
            {
              ...(engineOptions?.useCache !== false && { cache: this._cache }),
            },
          );
        }

        // Check if cameraFoldersContent has a 'videos' subfolder
        const videoFolder = cameraFoldersContent.find(
          (c) => c.can_expand && c.title.toLowerCase() === 'videos',
        );

        let targetsToSearchForDates: (string | RichBrowseMedia<BrowseMediaMetadata>)[] =
          [];
        if (videoFolder) {
          targetsToSearchForDates = [videoFolder.media_content_id];
        } else {
          // If no 'videos' subfolder, check if cameraFoldersContent already contains date folders
          const dateFoldersDirect = cameraFoldersContent
            .map((c) => ({
              ...c,
              _metadata: this._tplinkDirectoryMetadataGenerator(camera.getID(), c),
            }))
            .filter(
              (c) =>
                c.can_expand &&
                c._metadata &&
                isMediaWithinDates(
                  c as RichBrowseMedia<BrowseMediaMetadata>,
                  matchOptions?.start,
                  matchOptions?.end,
                ),
            ) as RichBrowseMedia<BrowseMediaMetadata>[];

          if (dateFoldersDirect.length > 0) {
            return sortMostRecentFirst(dateFoldersDirect);
          }

          // Check if cameraFoldersContent already contains direct videos (flat storage)
          const hasDirectVideos = cameraFoldersContent.some(
            (c) =>
              !c.can_expand &&
              (c.media_class === MEDIA_CLASS_VIDEO ||
                c.can_play ||
                c.media_content_type === 'video' ||
                c.title.toLowerCase().endsWith('.mp4')),
          );

          if (hasDirectVideos) {
            return cameraFolderUris.map(
              (uri) =>
                ({
                  title: cameraTitle ?? cameraID,
                  media_class: 'directory',
                  media_content_type: 'video',
                  media_content_id: uri,
                  children_media_class: 'directory',
                  can_play: false,
                  can_expand: true,
                  _metadata: {
                    cameraID: camera.getID(),
                    startDate: new Date(0),
                    endDate: new Date(8640000000000000),
                  },
                }) as RichBrowseMedia<BrowseMediaMetadata>,
            );
          }

          targetsToSearchForDates = cameraFolderUris;
        }

        // Search for date directories inside targetsToSearchForDates (e.g. inside 'videos' folder)
        let dateDirectories = await this._browseMediaWalker.walk(
          hass,
          [
            {
              targets: targetsToSearchForDates,
              metadataGenerator: (media: BrowseMedia) =>
                this._tplinkDirectoryMetadataGenerator(camera.getID(), media),
              matcher: (media: RichBrowseMedia<BrowseMediaMetadata>) =>
                media.can_expand &&
                isMediaWithinDates(media, matchOptions?.start, matchOptions?.end),
              sorter: (media: RichBrowseMedia<BrowseMediaMetadata>[]) =>
                sortMostRecentFirst(media),
            },
          ],
          {
            ...(engineOptions?.useCache !== false && { cache: this._cache }),
          },
        );

        // If no date directories were found inside videos, check if videos contains flat video files directly
        if (!dateDirectories?.length && videoFolder) {
          const videosChildren = await this._browseMediaWalker.walk(
            hass,
            [
              {
                targets: [videoFolder.media_content_id],
              },
            ],
            {
              ...(engineOptions?.useCache !== false && { cache: this._cache }),
            },
          );

          const hasDirectVideosInVideos = videosChildren.some(
            (c) =>
              !c.can_expand &&
              (c.media_class === MEDIA_CLASS_VIDEO ||
                c.can_play ||
                c.media_content_type === 'video' ||
                c.title.toLowerCase().endsWith('.mp4')),
          );

          if (hasDirectVideosInVideos) {
            dateDirectories = [
              {
                title: cameraTitle ?? cameraID,
                media_class: 'directory',
                media_content_type: 'video',
                media_content_id: videoFolder.media_content_id,
                children_media_class: 'directory',
                can_play: false,
                can_expand: true,
                _metadata: {
                  cameraID: camera.getID(),
                  startDate: new Date(0),
                  endDate: new Date(8640000000000000),
                },
              } as RichBrowseMedia<BrowseMediaMetadata>,
            ];
          }
        }

        if (dateDirectories?.length) {
          return dateDirectories;
        }
      }
    }

    // Strategy 2: Browse media-source://tapo_control
    const allCameras = await this._browseMediaWalker.walk(
      hass,
      [
        {
          targets: [`media-source://tapo_control`],
          metadataGenerator: (media: BrowseMedia) =>
            this._tplinkCameraMetadataGenerator(media),
        },
      ],
      {
        ...(engineOptions?.useCache !== false && { cache: this._camerasCache }),
      },
    );

    let camerasWithMedia = allCameras?.filter(isCameraMatch) ?? [];
    if (!camerasWithMedia.length && allCameras?.length === 1) {
      camerasWithMedia = allCameras;
    }

    let dateDirectories: RichBrowseMedia<BrowseMediaMetadata>[] = [];

    if (camerasWithMedia?.length) {
      dateDirectories = await this._browseMediaWalker.walk(
        hass,
        [
          {
            targets: camerasWithMedia,
            metadataGenerator: (media: BrowseMedia) =>
              this._tplinkDirectoryMetadataGenerator(camera.getID(), media),
            matcher: (media: RichBrowseMedia<BrowseMediaMetadata>) =>
              media.can_expand &&
              isMediaWithinDates(media, matchOptions?.start, matchOptions?.end),
            sorter: (media: RichBrowseMedia<BrowseMediaMetadata>[]) =>
              sortMostRecentFirst(media),
          },
        ],
        {
          ...(engineOptions?.useCache !== false && { cache: this._cache }),
        },
      );
    }

    return dateDirectories.length ? dateDirectories : null;
  }

  public async getEvents(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: EventQuery,
    engineOptions?: EngineOptions,
  ): Promise<EventQueryResultsMap | null> {
    if (hasUnsupportedFilters(query) || query.hasSnapshot) {
      return null;
    }

    const output: EventQueryResultsMap = new Map();
    const getEventsForCamera = async (cameraID: string): Promise<void> => {
      const perCameraQuery = { ...query, cameraIDs: new Set([cameraID]) };
      const cachedResult =
        (engineOptions?.useCache ?? true)
          ? this._requestCache.get(perCameraQuery)
          : null;
      if (cachedResult) {
        output.set(perCameraQuery, cachedResult as EventQueryResults);
        return;
      }

      const sortedMedia = await this._getBrowseMediaForCamera(
        hass,
        store,
        cameraID,
        perCameraQuery,
        engineOptions,
      );

      const results: TPLinkEventQueryResults = {
        engine: Engine.TPLink,
        type: QueryResultsType.Event,
        browseMedia: sortedMedia,
        expiry: add(new Date(), { seconds: BROWSE_MEDIA_CACHE_SECONDS }),
      };

      if (engineOptions?.useCache ?? true) {
        this._requestCache.set(
          perCameraQuery,
          { ...results, cached: true },
          results.expiry,
        );
      }
      output.set(perCameraQuery, results);
    };

    await allPromises(query.cameraIDs, (cameraID) => getEventsForCamera(cameraID));
    return output;
  }

  public generateMediaFromEvents(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: EventQuery,
    results: QueryReturnType<EventQuery>,
  ): ViewMedia[] | null {
    if (!TPLinkQueryResultsClassifier.isTPLinkEventQueryResults(results)) {
      return null;
    }
    return getViewMediaFromBrowseMediaArray(results.browseMedia);
  }

  public generateDefaultRecordingQuery(
    _store: CameraManagerReadOnlyConfigStore,
    cameraIDs: Set<string>,
    query?: PartialRecordingQuery,
  ): RecordingQuery[] | null {
    return [
      {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: cameraIDs,
        ...query,
      },
    ];
  }

  public async getRecordings(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: RecordingQuery,
    engineOptions?: EngineOptions,
  ): Promise<RecordingQueryResultsMap | null> {
    if (hasUnsupportedFilters(query)) {
      return null;
    }

    const output: RecordingQueryResultsMap = new Map();
    const getRecordingsForCamera = async (cameraID: string): Promise<void> => {
      const perCameraQuery = { ...query, cameraIDs: new Set([cameraID]) };
      const cachedResult =
        (engineOptions?.useCache ?? true)
          ? this._requestCache.get(perCameraQuery)
          : null;
      if (cachedResult) {
        output.set(perCameraQuery, cachedResult as TPLinkRecordingQueryResults);
        return;
      }

      const sortedMedia = await this._getBrowseMediaForCamera(
        hass,
        store,
        cameraID,
        perCameraQuery,
        engineOptions,
      );

      const results: TPLinkRecordingQueryResults = {
        engine: Engine.TPLink,
        type: QueryResultsType.Recording,
        browseMedia: sortedMedia,
        expiry: add(new Date(), { seconds: BROWSE_MEDIA_CACHE_SECONDS }),
      };

      if (engineOptions?.useCache ?? true) {
        this._requestCache.set(
          perCameraQuery,
          { ...results, cached: true },
          results.expiry,
        );
      }
      output.set(perCameraQuery, results);
    };

    await allPromises(query.cameraIDs, (cameraID) => getRecordingsForCamera(cameraID));
    return output;
  }

  public generateMediaFromRecordings(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: RecordingQuery,
    results: QueryReturnType<RecordingQuery>,
  ): ViewMedia[] | null {
    if (!TPLinkQueryResultsClassifier.isTPLinkRecordingQueryResults(results)) {
      return null;
    }
    return getViewMediaFromBrowseMediaArray(results.browseMedia);
  }

  public override getQueryResultMaxAge(query: CameraQuery): number | null {
    if (query.type === QueryType.Event || query.type === QueryType.Recording) {
      return BROWSE_MEDIA_CACHE_SECONDS;
    }
    return null;
  }

  private async _getBrowseMediaForCamera(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    cameraID: string,
    query: EventQuery | RecordingQuery,
    engineOptions?: EngineOptions,
  ): Promise<RichBrowseMedia<BrowseMediaMetadata>[]> {
    const camera = store.getCamera(cameraID);
    const directories =
      camera && camera instanceof TPLinkCamera
        ? await this._getMatchingDirectories(hass, camera, query, engineOptions)
        : null;
    const limit = query.limit ?? CAMERA_MANAGER_ENGINE_EVENT_LIMIT_DEFAULT;
    let media: RichBrowseMedia<BrowseMediaMetadata>[] = [];

    if (directories?.length) {
      media = await this._browseMediaWalker.walk(
        hass,
        [
          {
            targets: directories,
            concurrency: 1,
            metadataGenerator: (
              media: BrowseMedia,
              parent?: RichBrowseMedia<BrowseMediaMetadata>,
            ) => this._tplinkFileMetadataGenerator(cameraID, media, parent),
            earlyExit: (media) => media.length >= limit,
            matcher: (media: RichBrowseMedia<BrowseMediaMetadata>) =>
              !media.can_expand && isMediaWithinDates(media, query.start, query.end),
            sorter: (media: RichBrowseMedia<BrowseMediaMetadata>[]) =>
              sortMostRecentFirst(media),
          },
        ],
        {
          ...(engineOptions?.useCache !== false && { cache: this._cache }),
        },
      );
    }

    return orderBy(
      media,
      (media: RichBrowseMedia<BrowseMediaMetadata>) => media._metadata?.startDate,
      'desc',
    ).slice(0, limit);
  }

  public async getMediaMetadata(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: MediaMetadataQuery,
    engineOptions?: EngineOptions,
  ): Promise<MediaMetadataQueryResultsMap | null> {
    const output: MediaMetadataQueryResultsMap = new Map();
    const cachedResult =
      (engineOptions?.useCache ?? true) ? this._requestCache.get(query) : null;

    if (cachedResult) {
      output.set(query, cachedResult as MediaMetadataQueryResults);
      return output;
    }

    const days: Set<string> = new Set();
    const getDaysForCamera = async (cameraID: string): Promise<void> => {
      const camera = store.getCamera(cameraID);
      if (!camera || !(camera instanceof TPLinkCamera)) {
        return;
      }
      const directories = await this._getMatchingDirectories(
        hass,
        camera,
        null,
        engineOptions,
      );

      for (const dayDirectory of directories ?? []) {
        /* v8 ignore next: This situation cannot happen as the directory
        will not match without metadata -- @preserve */
        if (dayDirectory._metadata?.startDate) {
          days.add(formatDate(dayDirectory._metadata.startDate));
        }
      }
    };

    await allPromises(query.cameraIDs, (cameraID) => getDaysForCamera(cameraID));

    const result: MediaMetadataQueryResults = {
      type: QueryResultsType.MediaMetadata,
      engine: Engine.TPLink,
      metadata: {
        ...(days.size && { days: days }),
      },
      expiry: add(new Date(), { seconds: BROWSE_MEDIA_CACHE_SECONDS }),
      cached: false,
    };

    if (engineOptions?.useCache ?? true) {
      this._requestCache.set(query, { ...result, cached: true }, result.expiry);
    }
    output.set(query, result);
    return output;
  }

  public override async getMediaSeekTime(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    media: ViewMedia,
    target: Date,
  ): Promise<number | null> {
    const start = media.getStartTime();
    if (!start) {
      return null;
    }
    const end = media.getEndTime();
    const targetMs = target.getTime();
    const startMs = start.getTime();

    if (targetMs <= startMs) {
      return 0;
    }
    if (end && targetMs >= end.getTime()) {
      return Math.max(0, (end.getTime() - startMs) / 1000);
    }
    return Math.max(0, (targetMs - startMs) / 1000);
  }

  public getCameraMetadata(
    hass: HomeAssistant,
    cameraConfig: CameraConfig,
  ): CameraManagerCameraMetadata {
    return {
      ...super.getCameraMetadata(hass, cameraConfig),
      engineIcon: 'tplink',
    };
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { CameraManagerStore } from '../../../src/camera-manager/store';
import { TPLinkCameraManagerEngine } from '../../../src/camera-manager/tplink/engine-tplink';
import {
  TPLinkQueryResultsClassifier,
  type BrowseMediaTPLinkCameraMetadata,
  type TPLinkEventQueryResults,
  type TPLinkRecordingQueryResults,
} from '../../../src/camera-manager/tplink/types';
import {
  CameraManagerRequestCache,
  Engine,
  QueryResultsType,
  QueryType,
  type EventQuery,
  type PartialRecordingQuery,
  type QueryReturnType,
  type RecordingQuery,
} from '../../../src/camera-manager/types';
import {
  BROWSE_MEDIA_CACHE_SECONDS,
  type BrowseMedia,
  type BrowseMediaMetadata,
  type RichBrowseMedia,
} from '../../../src/ha/browse-media/types';
import { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import type { EntityRegistryManager } from '../../../src/ha/registry/entity/types';
import type { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { homeAssistantWSRequest } from '../../../src/ha/ws-request';
import { QuerySource } from '../../../src/query-source';
import { createCameraConfig } from '../../config/test-utils';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import {
  createHASS,
  createHASSManager,
  createRegistryEntity,
  createStateEntity,
} from '../../test-utils';
import { TestViewMedia } from '../../view/test-utils';
import { createStore } from '../test-utils';

vi.mock('../../../src/ha/ws-request');

const TEST_CAMERAS: BrowseMedia = {
  title: 'Tapo: Recordings',
  media_class: 'directory',
  media_content_type: 'video',
  media_content_id: 'media-source://tapo_control',
  children_media_class: 'directory',
  can_play: false,
  can_expand: true,
  thumbnail: null,
  children: [
    {
      title: 'Tapo C520WS Live View',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=Tapo+C520WS+Live+View',
      children_media_class: 'directory',
      can_play: false,
      can_expand: true,
      thumbnail: null,
    },
    {
      title: 'Camera Without Entry',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id: 'media-source://tapo_control/tapo_control/?title=Missing',
      children_media_class: 'directory',
      can_play: false,
      can_expand: true,
      thumbnail: null,
    },
  ],
};

const TEST_DIRECTORIES: BrowseMedia = {
  title: 'Tapo C520WS Live View',
  media_class: 'directory',
  media_content_type: 'video',
  media_content_id:
    'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=Tapo+C520WS+Live+View',
  children_media_class: 'directory',
  can_play: false,
  can_expand: true,
  thumbnail: null,
  children: [
    {
      title: '20241104',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=20241104&date=20241104',
      children_media_class: 'directory',
      can_play: false,
      can_expand: true,
      thumbnail: null,
    },
    {
      title: '2024-11-05',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=2024-11-05&date=2024-11-05',
      children_media_class: 'directory',
      can_play: false,
      can_expand: true,
      thumbnail: null,
    },
    {
      title: 'Invalid Date',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=Invalid+Date',
      children_media_class: 'directory',
      can_play: false,
      can_expand: true,
      thumbnail: null,
    },
  ],
};

const TEST_FILES: BrowseMedia = {
  title: '20241104',
  media_class: 'directory',
  media_content_type: 'video',
  media_content_id:
    'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=20241104&date=20241104',
  children_media_class: 'video',
  can_play: false,
  can_expand: true,
  thumbnail: null,
  children: [
    {
      title: '21:20:00 - 21:25:00',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A20%3A00+-+21%3A25%3A00&startDate=1730755200&endDate=1730755500',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: 'https://thumbnail.local/1.jpg',
    },
    {
      title: '21:30:00 - 21:35:00',
      media_class: 'directory',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A30%3A00+-+21%3A35%3A00',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: null,
    },
    {
      title: '21:40:00',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A40%3A00',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: null,
    },
    {
      title: 'Not A Video',
      media_class: 'directory',
      media_content_type: 'other',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=Not+A+Video',
      children_media_class: null,
      can_play: false,
      can_expand: false,
      thumbnail: null,
    },
    {
      title: 'Invalid',
      media_class: 'video',
      media_content_type: 'video',
      media_content_id:
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=Invalid',
      children_media_class: null,
      can_play: true,
      can_expand: false,
      thumbnail: null,
    },
  ],
};

const createEngine = (options?: {
  entityRegistryManager?: EntityRegistryManager;
  browseMediaManager?: BrowseMediaWalker;
  resolvedMediaCache?: ResolvedMediaCache;
  requestCache?: CameraManagerRequestCache;
}): TPLinkCameraManagerEngine => {
  return new TPLinkCameraManagerEngine(
    options?.entityRegistryManager ?? new EntityRegistryManagerMock(),
    createHASSManager(),
    options?.browseMediaManager ?? new BrowseMediaWalker(),
    options?.resolvedMediaCache ?? mock<ResolvedMediaCache>(),
    options?.requestCache ?? new CameraManagerRequestCache(),
  );
};

const cameraEntity = createRegistryEntity({
  entity_id: 'camera.tapo_c520ws_39d3_live_view',
  unique_id: '80115E1CF270233D6FC2FCD4028181A7206CDB30-live_view',
  platform: 'tplink',
  config_entry_id: 'tplink_config_entry_1',
});

const createPopulatedEngine = (options?: {
  browseMediaManager?: BrowseMediaWalker;
  requestCache?: CameraManagerRequestCache;
}): TPLinkCameraManagerEngine => {
  const entityRegistryManager = new EntityRegistryManagerMock([cameraEntity]);
  return createEngine({
    entityRegistryManager,
    ...options,
  });
};

const createStoreWithTPLinkCamera = async (
  engine: TPLinkCameraManagerEngine,
): Promise<CameraManagerStore> => {
  const store = new CameraManagerStore();
  const camera = await engine.createCamera(
    createCameraConfig({
      camera_entity: 'camera.tapo_c520ws_39d3_live_view',
      id: 'tapo_office',
    }),
  );
  store.addCamera(camera);
  return store;
};

describe('TPLinkQueryResultsClassifier', () => {
  it('should correctly identify matching results', () => {
    expect(
      TPLinkQueryResultsClassifier.isTPLinkEventQueryResults({
        type: QueryResultsType.Event,
        engine: Engine.TPLink,
      }),
    ).toBeTruthy();
  });

  it('should correctly identify non-matching results', () => {
    expect(
      TPLinkQueryResultsClassifier.isTPLinkEventQueryResults({
        type: QueryResultsType.Event,
        engine: Engine.Generic,
      }),
    ).toBeFalsy();

    expect(
      TPLinkQueryResultsClassifier.isTPLinkEventQueryResults({
        type: QueryResultsType.Recording,
        engine: Engine.TPLink,
      }),
    ).toBeFalsy();
  });
});

describe('TPLinkCameraManagerEngine', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should get correct engine type', () => {
    const engine = createEngine();
    expect(engine.getEngineType()).toBe(Engine.TPLink);
  });

  it('should create camera with clips capability', async () => {
    const engine = createPopulatedEngine();
    const config = createCameraConfig({
      camera_entity: 'camera.tapo_c520ws_39d3_live_view',
      id: 'tapo_office',
    });

    const camera = await engine.createCamera(config);

    expect(camera.getConfig()).toBe(config);
    expect(camera.getEngine()).toBe(engine);
    expect(camera.getCapabilities()?.getRawCapabilities()).toEqual({
      '2-way-audio': false,
      clips: true,
      recordings: true,
      'remote-control-entity': true,
      live: true,
      menu: true,
      substream: true,
      trigger: true,
    });
  });

  it('should get camera metadata with tplink icon', () => {
    const cameraConfig = createCameraConfig({
      title: 'Tapo Office',
      camera_entity: 'camera.tapo_c520ws_39d3_live_view',
      icon: 'mdi:camera',
    });
    const engine = createEngine();
    expect(engine.getCameraMetadata(createHASS(), cameraConfig)).toEqual({
      engineIcon: 'tplink',
      icon: {
        icon: 'mdi:camera',
        entity: 'camera.tapo_c520ws_39d3_live_view',
        fallback: 'mdi:video',
      },
      title: 'Tapo Office',
    });
  });

  it('should get camera metadata with auto-detected title', () => {
    const cameraConfig = createCameraConfig({
      camera_entity: 'camera.tapo_c520ws_39d3_live_view',
    });
    const hass = createHASS({
      'camera.tapo_c520ws_39d3_live_view': {
        entity_id: 'camera.tapo_c520ws_39d3_live_view',
        state: 'idle',
        attributes: {
          friendly_name: 'Tapo C520WS Live View',
        },
        last_changed: '',
        last_updated: '',
        context: { id: '', user_id: null, parent_id: null },
      },
    });
    const engine = createEngine();
    expect(engine.getCameraMetadata(hass, cameraConfig)).toEqual({
      engineIcon: 'tplink',
      icon: {
        entity: 'camera.tapo_c520ws_39d3_live_view',
        fallback: 'mdi:video',
      },
      title: 'Tapo C520WS Live View',
    });
  });

  describe('getEvents', () => {
    describe('should return null for unsupported features', () => {
      it.each([
        ['with favorite', { favorite: true }],
        ['with tags', { tags: new Set(['gate']) }],
        ['with what', { what: new Set(['car']) }],
        ['with where', { where: new Set(['office']) }],
        ['with hasSnapshot', { hasSnapshot: true }],
      ])('%s', async (_name: string, query: Partial<EventQuery>) => {
        const engine = createEngine();
        expect(
          await engine.getEvents(createHASS(), createStore(), {
            ...query,
            source: QuerySource.Camera,
            cameraIDs: new Set(['tapo_office']),
            type: QueryType.Event,
          }),
        ).toBeNull();
      });
    });

    it('should return empty events if camera not in store', async () => {
      const engine = createEngine();
      const store = createStore();
      const results = await engine.getEvents(createHASS(), store, {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['non_existent']),
      });

      expect(results).toBeDefined();
      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;
      expect(firstResult.browseMedia).toEqual([]);
    });

    it('should return empty events if camera has no config_entry_id', async () => {
      const entityWithoutConfig = createRegistryEntity({
        entity_id: 'camera.no_config',
        platform: 'tplink',
        config_entry_id: null,
      });
      const engine = createEngine({
        entityRegistryManager: new EntityRegistryManagerMock([entityWithoutConfig]),
      });
      const camera = await engine.createCamera(
        createCameraConfig({
          camera_entity: 'camera.no_config',
          id: 'no_config',
        }),
      );
      const store = new CameraManagerStore();
      store.addCamera(camera);

      const results = await engine.getEvents(createHASS(), store, {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['no_config']),
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;
      expect(firstResult.browseMedia).toEqual([]);
    });

    it('should return empty events if camera not found in tapo_control media', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest).mockResolvedValueOnce({
        title: 'Tapo: Recordings',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [],
      });

      const results = await engine.getEvents(createHASS(), store, {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;
      expect(firstResult.browseMedia).toEqual([]);
    });

    it('should return empty events if camera in store is not a TPLinkCamera', async () => {
      const engine = createEngine();
      const store = createStore([{ cameraID: 'generic_camera' }]);

      const results = await engine.getEvents(createHASS(), store, {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['generic_camera']),
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;
      expect(firstResult.browseMedia).toEqual([]);
    });

    it('should successfully get events without cache', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: EventQuery = {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const results = await engine.getEvents(createHASS(), store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;

      expect(firstResult.engine).toBe(Engine.TPLink);
      expect(firstResult.type).toBe(QueryResultsType.Event);
      // TEST_FILES has 3 valid video items out of 5
      expect(firstResult.browseMedia.length).toBe(3);

      const firstItem = firstResult.browseMedia[0];
      expect(firstItem._metadata).toEqual({
        cameraID: 'tapo_office',
        startDate: new Date(2024, 10, 4, 21, 40, 0),
        endDate: new Date(2024, 10, 4, 21, 40, 30),
      });

      // Second item parsed from title "21:30:00 - 21:35:00" relative to directory 2024-11-04
      const secondItem = firstResult.browseMedia[1];
      expect(secondItem._metadata).toEqual({
        cameraID: 'tapo_office',
        startDate: new Date(2024, 10, 4, 21, 30, 0),
        endDate: new Date(2024, 10, 4, 21, 35, 0),
      });

      // Third item parsed from URL params
      const thirdItem = firstResult.browseMedia[2];
      expect(thirdItem._metadata).toEqual({
        cameraID: 'tapo_office',
        startDate: new Date(1730755200 * 1000),
        endDate: new Date(1730755500 * 1000),
        thumbnailOverride: 'https://thumbnail.local/1.jpg',
      });
      expect(thirdItem.media_class).toBe('video');
    });

    it('should use request cache on repeat queries', async () => {
      const requestCache = new CameraManagerRequestCache();
      const engine = createPopulatedEngine({ requestCache });
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: EventQuery = {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const results1 = await engine.getEvents(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(3);

      const results2 = await engine.getEvents(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(3);

      const first1 = Array.from(results1?.values() ?? [])[0];
      const first2 = Array.from(results2?.values() ?? [])[0];
      expect(first2).toEqual({ ...first1, cached: true });
    });

    it('should respect query limit', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: EventQuery = {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
        limit: 1,
      };

      const results = await engine.getEvents(createHASS(), store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkEventQueryResults;
      expect(firstResult.browseMedia.length).toBe(1);
    });
  });

  describe('generateMediaFromEvents', () => {
    it('should convert browse media events to view media', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: EventQuery = {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const resultsMap = await engine.getEvents(createHASS(), store, query, {
        useCache: false,
      });
      const results = Array.from(
        resultsMap?.values() ?? [],
      )[0] as TPLinkEventQueryResults;

      const media = engine.generateMediaFromEvents(createHASS(), store, query, results);
      expect(media?.length).toBe(3);
      expect(media?.[0].getContentID()).toBe(
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A40%3A00',
      );
      expect(media?.[2].getContentID()).toBe(
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A20%3A00+-+21%3A25%3A00&startDate=1730755200&endDate=1730755500',
      );
    });

    it('should return null for non-tplink results', () => {
      const engine = createEngine();
      const store = createStore();
      const query: EventQuery = {
        source: QuerySource.Camera,
        type: QueryType.Event,
        cameraIDs: new Set(['tapo_office']),
      };

      const results: QueryReturnType<EventQuery> = {
        engine: Engine.Generic,
        type: QueryResultsType.Event,
      };

      expect(
        engine.generateMediaFromEvents(createHASS(), store, query, results),
      ).toBeNull();
    });
  });

  describe('generateDefaultRecordingQuery', () => {
    it('should generate default recording query', () => {
      const engine = createEngine();
      const store = createStore();
      const cameraIDs = new Set(['camera_1', 'camera_2']);
      const query: PartialRecordingQuery = { limit: 50 };

      expect(engine.generateDefaultRecordingQuery(store, cameraIDs, query)).toEqual([
        {
          source: QuerySource.Camera,
          type: QueryType.Recording,
          cameraIDs: cameraIDs,
          limit: 50,
        },
      ]);
    });
  });

  describe('getRecordings', () => {
    describe('should return null for unsupported features', () => {
      it.each([
        ['with favorite', { favorite: true }],
        ['with tags', { tags: new Set(['gate']) }],
        ['with what', { what: new Set(['car']) }],
        ['with where', { where: new Set(['office']) }],
      ])('%s', async (_name: string, query: Partial<RecordingQuery>) => {
        const engine = createEngine();
        expect(
          await engine.getRecordings(createHASS(), createStore(), {
            ...query,
            source: QuerySource.Camera,
            cameraIDs: new Set(['tapo_office']),
            type: QueryType.Recording,
          }),
        ).toBeNull();
      });
    });

    it('should successfully get recordings', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const results = await engine.getRecordings(createHASS(), store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkRecordingQueryResults;

      expect(firstResult.engine).toBe(Engine.TPLink);
      expect(firstResult.type).toBe(QueryResultsType.Recording);
      expect(firstResult.browseMedia.length).toBe(3);
    });

    it('should use request cache on repeat queries', async () => {
      const requestCache = new CameraManagerRequestCache();
      const engine = createPopulatedEngine({ requestCache });
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const results1 = await engine.getRecordings(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(3);

      const results2 = await engine.getRecordings(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(3);

      const first1 = Array.from(results1?.values() ?? [])[0];
      const first2 = Array.from(results2?.values() ?? [])[0];
      expect(first2).toEqual({ ...first1, cached: true });
    });
  });

  describe('generateMediaFromRecordings', () => {
    it('should convert browse media recordings to view media', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES)
        .mockResolvedValueOnce(TEST_FILES);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['tapo_office']),
        start: new Date('2024-11-04T00:00:00'),
        end: new Date('2024-11-04T23:59:59'),
      };

      const resultsMap = await engine.getRecordings(createHASS(), store, query, {
        useCache: false,
      });
      const results = Array.from(
        resultsMap?.values() ?? [],
      )[0] as TPLinkRecordingQueryResults;

      const media = engine.generateMediaFromRecordings(
        createHASS(),
        store,
        query,
        results,
      );
      expect(media?.length).toBe(3);
      expect(media?.[0].getContentID()).toBe(
        'media-source://tapo_control/tapo_control/?entry=tplink_config_entry_1&title=21%3A40%3A00',
      );
    });

    it('should return null for non-tplink results', () => {
      const engine = createEngine();
      const store = createStore();
      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['tapo_office']),
      };

      const results: QueryReturnType<RecordingQuery> = {
        engine: Engine.Generic,
        type: QueryResultsType.Recording,
      };

      expect(
        engine.generateMediaFromRecordings(createHASS(), store, query, results),
      ).toBeNull();
    });
  });

  describe('getQueryResultMaxAge', () => {
    it('should return cache seconds for Event and Recording queries', () => {
      const engine = createEngine();

      expect(
        engine.getQueryResultMaxAge({
          type: QueryType.Event,
          cameraIDs: new Set(['tapo_office']),
        }),
      ).toBe(BROWSE_MEDIA_CACHE_SECONDS);

      expect(
        engine.getQueryResultMaxAge({
          type: QueryType.Recording,
          cameraIDs: new Set(['tapo_office']),
        }),
      ).toBe(BROWSE_MEDIA_CACHE_SECONDS);

      expect(
        engine.getQueryResultMaxAge({
          type: QueryType.RecordingSegments,
          cameraIDs: new Set(['tapo_office']),
        }),
      ).toBeNull();
    });
  });

  describe('getMediaMetadata', () => {
    it('should return days from matching directories', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES);

      const metadata = await engine.getMediaMetadata(
        createHASS(),
        store,
        {
          type: QueryType.MediaMetadata,
          cameraIDs: new Set(['tapo_office']),
        },
        { useCache: false },
      );

      const firstResult = Array.from(metadata?.values() ?? [])[0];
      expect(firstResult.metadata.days).toEqual(new Set(['2024-11-04', '2024-11-05']));
    });

    it('should return cached media metadata', async () => {
      const requestCache = new CameraManagerRequestCache();
      const engine = createPopulatedEngine({ requestCache });
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TEST_CAMERAS)
        .mockResolvedValueOnce(TEST_DIRECTORIES);

      const query = {
        type: QueryType.MediaMetadata as const,
        cameraIDs: new Set(['tapo_office']),
      };

      const result1 = await engine.getMediaMetadata(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(2);

      const result2 = await engine.getMediaMetadata(createHASS(), store, query);
      expect(homeAssistantWSRequest).toHaveBeenCalledTimes(2);

      const firstResult1 = Array.from(result1?.values() ?? [])[0];
      const firstResult2 = Array.from(result2?.values() ?? [])[0];
      expect(firstResult2).toEqual({ ...firstResult1, cached: true });
    });

    it('should return empty metadata if camera not found in store', async () => {
      const engine = createEngine();
      const store = createStore();

      const metadata = await engine.getMediaMetadata(createHASS(), store, {
        type: QueryType.MediaMetadata,
        cameraIDs: new Set(['unknown']),
      });

      const firstResult = Array.from(metadata?.values() ?? [])[0];
      expect(firstResult?.metadata?.days).toBeUndefined();
    });

    it('should return empty metadata if camera not found in tapo_control media', async () => {
      const engine = createPopulatedEngine();
      const store = await createStoreWithTPLinkCamera(engine);

      vi.mocked(homeAssistantWSRequest).mockResolvedValueOnce({
        title: 'Tapo: Recordings',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [],
      });

      const metadata = await engine.getMediaMetadata(createHASS(), store, {
        type: QueryType.MediaMetadata,
        cameraIDs: new Set(['tapo_office']),
      });

      const firstResult = Array.from(metadata?.values() ?? [])[0];
      expect(firstResult?.metadata?.days).toBeUndefined();
    });

    it('should return empty metadata if camera in store is not a TPLinkCamera', async () => {
      const engine = createEngine();
      const store = createStore([{ cameraID: 'generic_camera' }]);

      const metadata = await engine.getMediaMetadata(createHASS(), store, {
        type: QueryType.MediaMetadata,
        cameraIDs: new Set(['generic_camera']),
      });

      const firstResult = Array.from(metadata?.values() ?? [])[0];
      expect(firstResult?.metadata?.days).toBeUndefined();
    });
  });

  describe('_tplinkCameraMetadataGenerator', () => {
    it('should retain title even when entry is missing', () => {
      const engine = createEngine() as unknown as {
        _tplinkCameraMetadataGenerator: (
          media: BrowseMedia,
        ) => BrowseMediaTPLinkCameraMetadata;
      };
      expect(
        engine._tplinkCameraMetadataGenerator({
          title: 'Camera',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/tapo_control/?title=Missing',
          children_media_class: null,
          can_play: false,
          can_expand: true,
          thumbnail: null,
        }),
      ).toEqual({
        title: 'Camera',
      });
    });

    it('should extract configEntryID and childID', () => {
      const engine = createEngine() as unknown as {
        _tplinkCameraMetadataGenerator: (
          media: BrowseMedia,
        ) => BrowseMediaTPLinkCameraMetadata;
      };
      expect(
        engine._tplinkCameraMetadataGenerator({
          title: 'Camera',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/tapo_control/?entry=entry_1&childID=child_1',
          children_media_class: null,
          can_play: false,
          can_expand: true,
          thumbnail: null,
        }),
      ).toEqual({
        configEntryID: 'entry_1',
        childID: 'child_1',
        title: 'Camera',
      });
    });
  });

  describe('_tplinkDirectoryMetadataGenerator', () => {
    it('should return null for invalid date directory', () => {
      const engine = createEngine() as unknown as {
        _tplinkDirectoryMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
        ) => BrowseMediaMetadata | null;
      };
      expect(
        engine._tplinkDirectoryMetadataGenerator('tapo_office', {
          title: 'Not A Date',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/',
          children_media_class: null,
          can_play: false,
          can_expand: true,
          thumbnail: null,
        }),
      ).toBeNull();
    });

    it('should parse yyyyMMdd, yyyy-MM-dd, and dd/MM/yyyy dates', () => {
      const engine = createEngine() as unknown as {
        _tplinkDirectoryMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
        ) => BrowseMediaMetadata | null;
      };
      const parsed1 = engine._tplinkDirectoryMetadataGenerator('tapo_office', {
        title: '20241104',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
      });
      expect(parsed1?.startDate).toEqual(new Date(2024, 10, 4, 0, 0, 0));

      const parsed2 = engine._tplinkDirectoryMetadataGenerator('tapo_office', {
        title: '2024-11-05',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
      });
      expect(parsed2?.startDate).toEqual(new Date(2024, 10, 5, 0, 0, 0));

      const parsed3 = engine._tplinkDirectoryMetadataGenerator('tapo_office', {
        title: '05/11/2024',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
      });
      expect(parsed3?.startDate).toEqual(new Date(2024, 10, 5, 0, 0, 0));
    });
  });

  describe('_tplinkFileMetadataGenerator', () => {
    it('should return null when parent or parent metadata is missing', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const media: BrowseMedia = {
        title: '21:00:00 - 21:05:00',
        media_class: 'video',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/',
        children_media_class: null,
        can_play: true,
        can_expand: false,
        thumbnail: null,
      };

      expect(engine._tplinkFileMetadataGenerator('tapo_office', media)).toBeNull();
      expect(
        engine._tplinkFileMetadataGenerator('tapo_office', media, {
          ...media,
          _metadata: { cameraID: 'tapo_office' },
        }),
      ).toBeNull();
    });

    it('should return null when media cannot be played and is not video', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20241104',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2024, 10, 4),
        },
      };

      expect(
        engine._tplinkFileMetadataGenerator(
          'tapo_office',
          {
            title: 'sub-dir',
            media_class: 'directory',
            media_content_type: 'other',
            media_content_id: 'id',
            children_media_class: null,
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
          parent,
        ),
      ).toBeNull();
    });

    it('should parse start and end dates from URL parameters', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20241104',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2024, 10, 4),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'tapo_office',
        {
          title: 'file',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/?startDate=1730755200&endDate=1730755500',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: 'https://thumb.local',
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(1730755200 * 1000));
      expect(result?.endDate).toEqual(new Date(1730755500 * 1000));
      expect(result?.thumbnailOverride).toBe('https://thumb.local');
    });

    it('should fallback to title when URL start/end dates are invalid numbers', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20241104',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2024, 10, 4),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'tapo_office',
        {
          title: '21:00:00 - 21:05:00',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/?startDate=0&endDate=0',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(2024, 10, 4, 21, 0, 0));
      expect(result?.endDate).toEqual(new Date(2024, 10, 4, 21, 5, 0));
    });

    it('should handle title with invalid end time by falling back to positive duration', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20241104',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2024, 10, 4),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'tapo_office',
        {
          title: '21:00:00 - invalidEnd',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(2024, 10, 4, 21, 0, 0));
      expect(result?.endDate).toEqual(new Date(2024, 10, 4, 21, 0, 30));
    });

    it('should parse filename with camera entity prefix and repeated timestamps', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20260912',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2026, 8, 12),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'tapo_office',
        {
          title:
            'camera-sala-sala-02-hd-stream_camera-sala-sala-02-hd-stream-2026-09-12-14-39-55_2026-09-12-14-39-55.mp4',
          media_class: 'directory',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/?file=camera-sala-sala-02-hd-stream_camera-sala-sala-02-hd-stream-2026-09-12-14-39-55_2026-09-12-14-39-55.mp4&duration=16',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(2026, 8, 12, 14, 39, 55));
      expect(result?.endDate).toEqual(new Date(2026, 8, 12, 14, 40, 11));
    });

    it('should parse unix timestamp range format in content id', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '20240911',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'tapo_office',
          startDate: new Date(2024, 8, 11),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'tapo_office',
        {
          title: '1726097713-1726097740.mp4',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/1726097713-1726097740.mp4',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(1726097713 * 1000));
      expect(result?.endDate).toEqual(new Date(1726097740 * 1000));
    });

    it('should parse Tapo Care Backup filename format with formatted title and duration', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '11/09/2026',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/?camera=sala_02&date=2026-09-11',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'sala_02',
          startDate: new Date(2026, 8, 11),
        },
      };

      // 1. 2026-09-11_23-35-13_0_1268dab1c2.mp4 with formatted title
      const res1 = engine._tplinkFileMetadataGenerator(
        'sala_02',
        {
          title: '23:35:13 - 23:35:43',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/?camera=sala_02&date=2026-09-11&file=2026-09-11_23-35-13_0_1268dab1c2.mp4&duration=30',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: 'https://thumb.local/1.jpg',
        },
        parent,
      );
      expect(res1?.startDate).toEqual(new Date(2026, 8, 11, 23, 35, 13));
      expect(res1?.endDate).toEqual(new Date(2026, 8, 11, 23, 35, 43));
      expect(res1?.thumbnailOverride).toBe('https://thumb.local/1.jpg');

      // 2. 2026-09-11_23-36-07_0_0bf7beb817.mp4
      const res2 = engine._tplinkFileMetadataGenerator(
        'sala_02',
        {
          title: '23:36:07 - 23:36:37',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/?camera=sala_02&date=2026-09-11&file=2026-09-11_23-36-07_0_0bf7beb817.mp4',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );
      expect(res2?.startDate).toEqual(new Date(2026, 8, 11, 23, 36, 7));
      expect(res2?.endDate).toEqual(new Date(2026, 8, 11, 23, 36, 37));

      // 3. 2026-09-11_23-36-42_0_09495ef5f9 with raw filename as title (without parent metadata)
      const res3 = engine._tplinkFileMetadataGenerator(
        'sala_02',
        {
          title: '2026-09-11_23-36-42_0_09495ef5f9',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id:
            'media-source://tapo_control/?camera=sala_02&file=2026-09-11_23-36-42_0_09495ef5f9.mp4',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        undefined,
      );
      expect(res3?.startDate).toEqual(new Date(2026, 8, 11, 23, 36, 42));
      expect(res3?.endDate).toEqual(new Date(2026, 8, 11, 23, 37, 12));
    });

    it('should parse hyphen-separated time range in title', () => {
      const engine = createEngine() as unknown as {
        _tplinkFileMetadataGenerator: (
          cameraID: string,
          media: BrowseMedia,
          parent?: RichBrowseMedia<BrowseMediaMetadata>,
        ) => BrowseMediaMetadata | null;
      };
      const parent: RichBrowseMedia<BrowseMediaMetadata> = {
        title: '2026-09-11',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'id',
        children_media_class: null,
        can_play: false,
        can_expand: true,
        thumbnail: null,
        _metadata: {
          cameraID: 'sala_02',
          startDate: new Date(2026, 8, 11),
        },
      };

      const result = engine._tplinkFileMetadataGenerator(
        'sala_02',
        {
          title: '23-35-13 - 23-35-43',
          media_class: 'video',
          media_content_type: 'video',
          media_content_id: 'media-source://tapo_control/',
          children_media_class: null,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        },
        parent,
      );

      expect(result?.startDate).toEqual(new Date(2026, 8, 11, 23, 35, 13));
      expect(result?.endDate).toEqual(new Date(2026, 8, 11, 23, 35, 43));
    });
  });

  describe('getMediaSeekTime', () => {
    it('should return null if media has no start time', async () => {
      const engine = createEngine();
      const media = new TestViewMedia({ startTime: null });

      expect(
        await engine.getMediaSeekTime(
          createHASS(),
          createStore(),
          media,
          new Date('2024-11-04T21:00:10Z'),
        ),
      ).toBeNull();
    });

    it('should return 0 if target is before or at start time', async () => {
      const engine = createEngine();
      const start = new Date('2024-11-04T21:00:00Z');
      const end = new Date('2024-11-04T21:00:30Z');
      const media = new TestViewMedia({ startTime: start, endTime: end });

      expect(
        await engine.getMediaSeekTime(
          createHASS(),
          createStore(),
          media,
          new Date('2024-11-04T20:59:50Z'),
        ),
      ).toBe(0);

      expect(
        await engine.getMediaSeekTime(createHASS(), createStore(), media, start),
      ).toBe(0);
    });

    it('should return offset in seconds if target is within media range', async () => {
      const engine = createEngine();
      const start = new Date('2024-11-04T21:00:00Z');
      const end = new Date('2024-11-04T21:00:30Z');
      const target = new Date('2024-11-04T21:00:15Z');
      const media = new TestViewMedia({ startTime: start, endTime: end });

      expect(
        await engine.getMediaSeekTime(createHASS(), createStore(), media, target),
      ).toBe(15);
    });

    it('should return duration if target is at or after end time', async () => {
      const engine = createEngine();
      const start = new Date('2024-11-04T21:00:00Z');
      const end = new Date('2024-11-04T21:00:30Z');
      const media = new TestViewMedia({ startTime: start, endTime: end });

      expect(
        await engine.getMediaSeekTime(
          createHASS(),
          createStore(),
          media,
          new Date('2024-11-04T21:01:00Z'),
        ),
      ).toBe(30);

      expect(
        await engine.getMediaSeekTime(createHASS(), createStore(), media, end),
      ).toBe(30);
    });
  });

  describe('dynamic camera matching', () => {
    it('should match camera by normalized title and token overlap without config entry id', async () => {
      const entity = createRegistryEntity({
        entity_id: 'camera.sala_02_hd_stream',
        platform: 'tplink',
        config_entry_id: 'different_or_missing_id',
      });
      const engine = createEngine({
        entityRegistryManager: new EntityRegistryManagerMock([entity]),
      });
      const camera = await engine.createCamera(
        createCameraConfig({
          camera_entity: 'camera.sala_02_hd_stream',
          id: 'sala_02',
          title: 'Sala_02 HD Stream',
        }),
      );
      const store = new CameraManagerStore();
      store.addCamera(camera);

      // tapo_control returns folder named 'Sala_02' without entry param
      const TAPO_CAMERAS: BrowseMedia = {
        title: 'Tapo: Recordings',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: 'Sala_02',
            media_class: 'directory',
            media_content_type: 'video',
            media_content_id: 'media-source://tapo_control/tapo_control/?camera=Sala_02',
            children_media_class: 'directory',
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
        ],
      };

      const SALA_DATES: BrowseMedia = {
        title: 'Sala_02',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/tapo_control/?camera=Sala_02',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-11',
            media_class: 'directory',
            media_content_type: 'video',
            media_content_id:
              'media-source://tapo_control/tapo_control/?date=2026-09-11',
            children_media_class: 'directory',
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
        ],
      };

      const SALA_VIDEOS: BrowseMedia = {
        title: '2026-09-11',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://tapo_control/tapo_control/?date=2026-09-11',
        children_media_class: 'video',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-11_23-35-13_0_1268dab1c2.mp4',
            media_class: 'video',
            media_content_type: 'video',
            media_content_id:
              'media-source://tapo_control/Sala_02/videos/2026-09-11/2026-09-11_23-35-13_0_1268dab1c2.mp4',
            children_media_class: null,
            can_play: true,
            can_expand: false,
            thumbnail: null,
          },
        ],
      };

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(TAPO_CAMERAS)
        .mockResolvedValueOnce(SALA_DATES)
        .mockResolvedValueOnce(SALA_VIDEOS);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['sala_02']),
      };

      const results = await engine.getRecordings(createHASS(), store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkRecordingQueryResults;

      expect(firstResult.browseMedia.length).toBe(1);
      expect(firstResult.browseMedia[0]._metadata?.startDate).toEqual(
        new Date(2026, 8, 11, 23, 35, 13),
      );
    });

    it('should fall back to native local media and navigate videos subfolder', async () => {
      const entity = createRegistryEntity({
        entity_id: 'camera.sala_02_hd_stream',
        platform: 'tplink',
        config_entry_id: 'some_id',
      });
      const engine = createEngine({
        entityRegistryManager: new EntityRegistryManagerMock([entity]),
      });
      const camera = await engine.createCamera(
        createCameraConfig({
          camera_entity: 'camera.sala_02_hd_stream',
          id: 'sala_02',
          title: 'Sala_02 HD Stream',
        }),
      );
      const store = new CameraManagerStore();
      store.addCamera(camera);

      // Inside Sala_02: has "videos" and "thumbs" subfolders
      const SALA_CHILDREN: BrowseMedia = {
        title: 'Sala_02',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://media_source/local/tapo/Sala_02',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: 'videos',
            media_class: 'directory',
            media_content_type: 'video',
            media_content_id: 'media-source://media_source/local/tapo/Sala_02/videos',
            children_media_class: 'directory',
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
        ],
      };

      // Inside videos: has date folder 2026-09-11
      const DATE_FOLDERS: BrowseMedia = {
        title: 'videos',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://media_source/local/tapo/Sala_02/videos',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-11',
            media_class: 'directory',
            media_content_type: 'video',
            media_content_id:
              'media-source://media_source/local/tapo/Sala_02/videos/2026-09-11',
            children_media_class: 'directory',
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
        ],
      };

      // Inside 2026-09-11: has video file
      const FILES: BrowseMedia = {
        title: '2026-09-11',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id:
          'media-source://media_source/local/tapo/Sala_02/videos/2026-09-11',
        children_media_class: 'video',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-11_23-35-13_0_1268dab1c2.mp4',
            media_class: 'video',
            media_content_type: 'video',
            media_content_id:
              'media-source://media_source/local/tapo/Sala_02/videos/2026-09-11/2026-09-11_23-35-13_0_1268dab1c2.mp4',
            children_media_class: null,
            can_play: true,
            can_expand: false,
            thumbnail: null,
          },
        ],
      };

      const hass = createHASS({
        'camera.sala_02_hd_stream': createStateEntity({
          entity_id: 'camera.sala_02_hd_stream',
          state: 'idle',
          attributes: {
            storage_path: '/media/tapo/Sala_02',
          },
        }),
      });

      // Directly queries local media without touching media-source://tapo_control
      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(SALA_CHILDREN)
        .mockResolvedValueOnce(DATE_FOLDERS)
        .mockResolvedValueOnce(FILES);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['sala_02']),
      };

      const results = await engine.getRecordings(hass, store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkRecordingQueryResults;

      expect(firstResult.browseMedia.length).toBe(1);
      expect(firstResult.browseMedia[0]._metadata?.startDate).toEqual(
        new Date(2026, 8, 11, 23, 35, 13),
      );
    });

    it('should query Cold storage path defined on media_sync switch', async () => {
      const cameraEntity = createRegistryEntity({
        entity_id: 'camera.quarto_hd_stream',
        platform: 'tplink',
        config_entry_id: 'quarto_entry',
        device_id: 'quarto_device',
      });
      const syncEntity = createRegistryEntity({
        entity_id: 'switch.quarto_media_sync',
        platform: 'tplink',
        config_entry_id: 'quarto_entry',
        device_id: 'quarto_device',
      });

      const engine = createEngine({
        entityRegistryManager: new EntityRegistryManagerMock([cameraEntity, syncEntity]),
      });
      const camera = await engine.createCamera(
        createCameraConfig({
          camera_entity: 'camera.quarto_hd_stream',
          id: 'quarto',
          title: 'Quarto HD Stream',
        }),
      );
      const store = new CameraManagerStore();
      store.addCamera(camera);

      const hass = createHASS({
        'switch.quarto_media_sync': createStateEntity({
          entity_id: 'switch.quarto_media_sync',
          state: 'on',
          attributes: {
            storage_path: '/media/tapo/Quarto',
          },
        }),
      });

      const QUARTO_ROOT: BrowseMedia = {
        title: 'Quarto',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://media_source/local/tapo/Quarto',
        children_media_class: 'directory',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-12',
            media_class: 'directory',
            media_content_type: 'video',
            media_content_id: 'media-source://media_source/local/tapo/Quarto/2026-09-12',
            children_media_class: 'directory',
            can_play: false,
            can_expand: true,
            thumbnail: null,
          },
        ],
      };

      const QUARTO_FILES: BrowseMedia = {
        title: '2026-09-12',
        media_class: 'directory',
        media_content_type: 'video',
        media_content_id: 'media-source://media_source/local/tapo/Quarto/2026-09-12',
        children_media_class: 'video',
        can_play: false,
        can_expand: true,
        thumbnail: null,
        children: [
          {
            title: '2026-09-12_10-00-00_0_abcdef1234.mp4',
            media_class: 'video',
            media_content_type: 'video',
            media_content_id:
              'media-source://media_source/local/tapo/Quarto/2026-09-12/2026-09-12_10-00-00_0_abcdef1234.mp4',
            children_media_class: null,
            can_play: true,
            can_expand: false,
            thumbnail: null,
          },
        ],
      };

      vi.mocked(homeAssistantWSRequest)
        .mockResolvedValueOnce(QUARTO_ROOT)
        .mockResolvedValueOnce(QUARTO_FILES);

      const query: RecordingQuery = {
        source: QuerySource.Camera,
        type: QueryType.Recording,
        cameraIDs: new Set(['quarto']),
      };

      const results = await engine.getRecordings(hass, store, query, {
        useCache: false,
      });

      const firstResult = Array.from(
        results?.values() ?? [],
      )[0] as TPLinkRecordingQueryResults;

      expect(firstResult.browseMedia.length).toBe(1);
      expect(firstResult.browseMedia[0]._metadata?.startDate).toEqual(
        new Date(2026, 8, 12, 10, 0, 0),
      );
    });
  });
});

import { add, sub } from 'date-fns';

import type { CameraManager } from '../camera-manager/manager.js';
import {
  QueryType,
  type EventQuery,
  type RecordingQuery,
} from '../camera-manager/types.js';
import { QuerySource } from '../query-source.js';
import { ViewItemClassifier } from '../view/item-classifier.js';
import type { ViewMedia } from '../view/item.js';
import { QueryResults } from '../view/query-results.js';
import { findBestMediaTimeIndex } from './find-best-media-time-index.js';

export interface GridSyncOptions {
  cameraManager?: CameraManager;
  targetTime: Date;
  selectedCameraID?: string;
  selectedItemID?: string | null;
  gridCameraIDs?: Set<string>;
}

export const syncGridResultsForTargetTime = async (
  currentResults: QueryResults,
  options: GridSyncOptions,
): Promise<QueryResults> => {
  const {
    cameraManager,
    targetTime,
    selectedCameraID,
    selectedItemID,
    gridCameraIDs: overrideGridCameraIDs,
  } = options;

  let newResults = currentResults.clone();

  const gridCameraIDs =
    overrideGridCameraIDs ??
    new Set([
      ...(cameraManager?.getStore().getCameraIDsWithCapability('live') ?? []),
      ...currentResults.getCameraIDs(),
    ]);

  const recordingCameraIDs =
    cameraManager?.getStore().getCameraIDsWithCapability('recordings') ??
    new Set<string>();
  const clipsCameraIDs =
    cameraManager?.getStore().getCameraIDsWithCapability('clips') ??
    new Set<string>();

  let additionalMedia: ViewMedia[] = [];
  for (const camID of gridCameraIDs) {
    if (camID === selectedCameraID) {
      continue;
    }
    const existingSelected = newResults.getSelectedResult(camID);
    const hasCovering =
      existingSelected &&
      ViewItemClassifier.isMedia(existingSelected) &&
      existingSelected.includesTime(targetTime);

    if (!hasCovering && cameraManager) {
      const hasRecordings = recordingCameraIDs.has(camID);
      const hasClips = clipsCameraIDs.has(camID);

      if (!hasRecordings && !hasClips) {
        continue;
      }

      const query = hasRecordings
        ? ({
            source: QuerySource.Camera,
            type: QueryType.Recording,
            cameraIDs: new Set([camID]),
            start: sub(targetTime, { hours: 1 }),
            end: add(targetTime, { hours: 1 }),
          } as RecordingQuery)
        : ({
            source: QuerySource.Camera,
            type: QueryType.Event,
            cameraIDs: new Set([camID]),
            start: sub(targetTime, { hours: 1 }),
            end: add(targetTime, { hours: 1 }),
          } as EventQuery);

      const queriedMedia = await cameraManager.executeMediaQueries([query], {
        useCache: true,
      });
      if (queriedMedia?.length) {
        additionalMedia = [...additionalMedia, ...queriedMedia];
      }
    }
  }

  if (additionalMedia.length) {
    const combinedItems = [...(newResults.getResults() ?? []), ...additionalMedia];
    newResults = new QueryResults({ results: combinedItems });
  }

  newResults.selectBestResult(
    (mediaArray) => findBestMediaTimeIndex(mediaArray, targetTime),
    { allCameras: true },
  );

  if (selectedItemID) {
    newResults.selectResultIfFound((result) => result.getID() === selectedItemID, {
      main: true,
      cameraID: selectedCameraID,
    });
  }

  return newResults;
};

import { add, sub } from 'date-fns';

import type { CameraManager } from '../camera-manager/manager.js';
import { QueryType, type RecordingQuery } from '../camera-manager/types.js';
import { QuerySource } from '../query-source.js';
import { ViewItemClassifier } from '../view/item-classifier.js';
import type { ViewItem, ViewMedia } from '../view/item.js';
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

  const liveCameraIDs = cameraManager
    ? cameraManager.getStore().getCameraIDsWithCapability('live')
    : [];
  const gridCameraIDs =
    overrideGridCameraIDs ??
    new Set([...liveCameraIDs, ...currentResults.getCameraIDs()]);

  const recordingCameraIDs = cameraManager
    ? cameraManager.getStore().getCameraIDsWithCapability('recordings')
    : new Set<string>();

  const additionalMedia: ViewMedia[] = [];
  for (const camID of gridCameraIDs) {
    if (camID === selectedCameraID) {
      continue;
    }
    const existingSelected = newResults.getSelectedResult(camID);
    const hasCovering =
      !!existingSelected &&
      ViewItemClassifier.isMedia(existingSelected) &&
      existingSelected.includesTime(targetTime);

    if (!hasCovering && cameraManager) {
      const hasRecordings = recordingCameraIDs.has(camID);
      if (hasRecordings) {
        const query: RecordingQuery = {
          source: QuerySource.Camera,
          type: QueryType.Recording,
          cameraIDs: new Set([camID]),
          start: sub(targetTime, { hours: 1 }),
          end: add(targetTime, { hours: 1 }),
        };

        const queriedMedia = await cameraManager.executeMediaQueries([query], {
          useCache: true,
        });
        if (queriedMedia && queriedMedia.length > 0) {
          additionalMedia.push(...queriedMedia);
        }
      }
    }
  }

  if (additionalMedia.length > 0) {
    const combinedItems = (newResults.getResults() as ViewItem[]).concat(
      additionalMedia,
    );
    newResults = new QueryResults({ results: combinedItems });
  }

  newResults.selectBestResult(
    (mediaArray) => findBestMediaTimeIndex(mediaArray, targetTime),
    { allCameras: true },
  );

  for (const camID of gridCameraIDs) {
    if (camID === selectedCameraID) {
      continue;
    }
    const camSelected = newResults.getSelectedResult(camID);
    if (
      !camSelected ||
      !ViewItemClassifier.isMedia(camSelected) ||
      !camSelected.includesTime(targetTime)
    ) {
      newResults.resetSelectedResult(camID);
    }
  }

  if (selectedItemID) {
    newResults.selectResultIfFound((result) => result.getID() === selectedItemID, {
      main: true,
      cameraID: selectedCameraID,
    });
  }

  return newResults;
};

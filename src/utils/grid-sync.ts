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

export const isMediaCoveringWithTolerance = (
  media: ViewItem,
  targetTime: Date,
  toleranceSeconds = 10,
): boolean => {
  if (!ViewItemClassifier.isMedia(media)) {
    return false;
  }
  const start = media.getStartTime();
  const end = media.getUsableEndTime();
  if (!start || !end) {
    return false;
  }
  const t = targetTime.getTime();
  const tolMs = toleranceSeconds * 1000;
  return t >= start.getTime() - tolMs && t <= end.getTime() + tolMs;
};

export const findBestMediaTimeIndexWithTolerance = (
  mediaArray: ViewItem[],
  targetTime: Date,
  toleranceSeconds = 10,
): number | null => {
  let bestIndex: number | null = null;
  let minDiff = Infinity;

  for (const [i, media] of mediaArray.entries()) {
    if (!ViewItemClassifier.isMedia(media)) {
      continue;
    }
    const start = media.getStartTime();
    const end = media.getUsableEndTime();
    if (!start || !end) {
      continue;
    }
    const t = targetTime.getTime();
    const s = start.getTime();
    const e = end.getTime();
    const tolMs = toleranceSeconds * 1000;

    if (t >= s - tolMs && t <= e + tolMs) {
      let diff = 0;
      if (t < s) {
        diff = s - t;
      } else if (t > e) {
        diff = t - e;
      }
      if (diff < minDiff) {
        minDiff = diff;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
};

export const syncGridResultsForTargetTime = async (
  currentResults: QueryResults,
  options: GridSyncOptions,
): Promise<QueryResults> => {
  const {
    cameraManager,
    targetTime,
    selectedCameraID: explicitSelectedCameraID,
    selectedItemID,
    gridCameraIDs: overrideGridCameraIDs,
  } = options;

  let newResults = currentResults.clone();

  const getCameraIDFromItem = (item?: ViewItem | null): string | undefined => {
    return ViewItemClassifier.isMedia(item)
      ? item.getCameraID() ?? undefined
      : undefined;
  };

  const selectedItem = selectedItemID
    ? newResults.getResults()?.find((m) => m.getID() === selectedItemID)
    : newResults.getSelectedResult();

  const rawSelectedCameraID =
    explicitSelectedCameraID ??
    getCameraIDFromItem(selectedItem) ??
    getCameraIDFromItem(newResults.getResults()?.[0]) ??
    undefined;
  const selectedCameraID = rawSelectedCameraID?.replace(/^camera\//, '');

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
    const normalizedCamID = camID.replace(/^camera\//, '');
    if (normalizedCamID === selectedCameraID) {
      continue;
    }
    const existingSelected =
      newResults.getSelectedResult(camID) ??
      newResults.getSelectedResult(normalizedCamID);
    const hasCovering =
      !!existingSelected &&
      ViewItemClassifier.isMedia(existingSelected) &&
      isMediaCoveringWithTolerance(existingSelected, targetTime, 10);

    if (!hasCovering && cameraManager) {
      const hasRecordings =
        recordingCameraIDs.has(camID) || recordingCameraIDs.has(normalizedCamID);
      if (hasRecordings) {
        const queryCamID = recordingCameraIDs.has(normalizedCamID)
          ? normalizedCamID
          : camID;
        const query: RecordingQuery = {
          source: QuerySource.Camera,
          type: QueryType.Recording,
          cameraIDs: new Set([queryCamID]),
          start: sub(targetTime, { hours: 2 }),
          end: add(targetTime, { hours: 2 }),
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
    const currentRecordingIDs = new Set(
      (newResults.getResults() ?? [])
        .filter((m) => ViewItemClassifier.isRecording(m))
        .map((m) => m.getID())
        .filter(Boolean),
    );
    const newItems = additionalMedia.filter((m) => {
      const id = m.getID();
      return !id || !currentRecordingIDs.has(id);
    });
    if (newItems.length > 0) {
      const currentSelectedID = newResults.getSelectedResult()?.getID();
      const combinedItems = (newResults.getResults() as ViewItem[]).concat(newItems);
      const selectedIndex = currentSelectedID
        ? combinedItems.findIndex((m) => m.getID() === currentSelectedID)
        : null;
      newResults = new QueryResults({
        results: combinedItems,
        selectedIndex:
          selectedIndex !== null && selectedIndex >= 0 ? selectedIndex : undefined,
      });
    }
  }

  for (const camID of gridCameraIDs) {
    const normalizedCamID = camID.replace(/^camera\//, '');
    if (normalizedCamID === selectedCameraID) {
      continue;
    }

    const existingSelected =
      newResults.getSelectedResult(normalizedCamID) ??
      newResults.getSelectedResult(camID);
    if (
      existingSelected &&
      ViewItemClassifier.isMedia(existingSelected) &&
      ViewItemClassifier.isRecording(existingSelected) &&
      isMediaCoveringWithTolerance(existingSelected, targetTime, 10)
    ) {
      continue;
    }

    const selectFollowerForCam = (targetCamID: string): boolean => {
      newResults.selectBestResult(
        (mediaArray) => {
          const recordings = mediaArray.filter((m) => ViewItemClassifier.isRecording(m));
          if (recordings.length > 0) {
            const recIndex = findBestMediaTimeIndex(recordings, targetTime);
            if (recIndex !== null) {
              return mediaArray.indexOf(recordings[recIndex]);
            }
            const recIndexTol = findBestMediaTimeIndexWithTolerance(
              recordings,
              targetTime,
              10,
            );
            if (recIndexTol !== null) {
              return mediaArray.indexOf(recordings[recIndexTol]);
            }
          }
          return null;
        },
        { cameraID: targetCamID },
      );

      const camSelected = newResults.getSelectedResult(targetCamID);
      if (
        !camSelected ||
        !ViewItemClassifier.isMedia(camSelected) ||
        !ViewItemClassifier.isRecording(camSelected) ||
        !isMediaCoveringWithTolerance(camSelected, targetTime, 10)
      ) {
        newResults.resetSelectedResult(targetCamID);
        return false;
      }
      return true;
    };

    const matched = selectFollowerForCam(normalizedCamID);
    if (!matched && camID !== normalizedCamID) {
      selectFollowerForCam(camID);
    }
  }

  let mainSelected = false;
  if (selectedItemID) {
    newResults.selectResultIfFound((result) => result.getID() === selectedItemID, {
      main: true,
      ...(selectedCameraID && { cameraID: selectedCameraID }),
    });
    if (newResults.hasSelectedResult()) {
      mainSelected = true;
    }
  }

  if (!mainSelected && selectedItem) {
    newResults.selectResultIfFound((result) => result === selectedItem, {
      main: true,
      ...(selectedCameraID && { cameraID: selectedCameraID }),
    });
    if (newResults.hasSelectedResult()) {
      mainSelected = true;
    }
  }

  if (
    !mainSelected &&
    selectedCameraID &&
    newResults.hasSelectedResult(selectedCameraID)
  ) {
    newResults.promoteCameraSelectionToMainSelection(selectedCameraID);
    if (newResults.hasSelectedResult()) {
      mainSelected = true;
    }
  }

  if (
    !mainSelected &&
    rawSelectedCameraID &&
    newResults.hasSelectedResult(rawSelectedCameraID)
  ) {
    newResults.promoteCameraSelectionToMainSelection(rawSelectedCameraID);
    if (newResults.hasSelectedResult()) {
      mainSelected = true;
    }
  }

  if (!mainSelected) {
    newResults.selectBestResult(
      (mediaArray) => findBestMediaTimeIndex(mediaArray, targetTime),
      { main: true },
    );
  }

  return newResults;
};

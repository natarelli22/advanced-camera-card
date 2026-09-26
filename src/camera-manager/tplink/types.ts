import type { BrowseMediaMetadata, RichBrowseMedia } from '../../ha/browse-media/types';
import {
  Engine,
  QueryResultsType,
  type EventQueryResults,
  type QueryResults,
  type RecordingQueryResults,
  type RecordingSegment,
  type RecordingSegmentsQueryResults,
} from '../types';

export class TPLinkQueryResultsClassifier {
  public static isTPLinkEventQueryResults(
    results: QueryResults,
  ): results is TPLinkEventQueryResults {
    return results.engine === Engine.TPLink && results.type === QueryResultsType.Event;
  }

  public static isTPLinkRecordingQueryResults(
    results: QueryResults,
  ): results is TPLinkRecordingQueryResults {
    return (
      results.engine === Engine.TPLink && results.type === QueryResultsType.Recording
    );
  }

  public static isTPLinkRecordingSegmentsQueryResults(
    results: QueryResults,
  ): results is TPLinkRecordingSegmentsQueryResults {
    return (
      results.engine === Engine.TPLink &&
      results.type === QueryResultsType.RecordingSegments
    );
  }
}

export interface TPLinkEventQueryResults extends EventQueryResults {
  engine: Engine.TPLink;
  browseMedia: RichBrowseMedia<BrowseMediaMetadata>[];
}

export interface TPLinkRecordingQueryResults extends RecordingQueryResults {
  engine: Engine.TPLink;
  browseMedia: RichBrowseMedia<BrowseMediaMetadata>[];
}

export interface TPLinkRecordingSegmentsQueryResults
  extends RecordingSegmentsQueryResults {
  engine: Engine.TPLink;
  segments: RecordingSegment[];
}

export interface BrowseMediaTPLinkCameraMetadata extends BrowseMediaMetadata {
  configEntryID?: string;
  childID?: string;
  camera?: string;
  cameraName?: string;
  title?: string;
}

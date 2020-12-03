import { PersistenceTransaction } from './persistence_transaction';
import { PersistencePromise } from './persistence_promise';
import { SortedMap } from '../util/sorted_map';
import { ListenSequenceNumber, TargetId } from '../core/types';
import { TargetData } from './target_data';

/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Describes a map whose keys are active target ids. We do not care about the type of the
 * values.
 */
export type ActiveTargets = SortedMap<TargetId, unknown>;

export const GC_DID_NOT_RUN: LruResults = {
  didRun: false,
  sequenceNumbersCollected: 0,
  targetsRemoved: 0,
  documentsRemoved: 0
};

export const LRU_COLLECTION_DISABLED = -1;
export const LRU_DEFAULT_CACHE_SIZE_BYTES = 40 * 1024 * 1024;

export class LruParams {
  private static readonly DEFAULT_COLLECTION_PERCENTILE = 10;
  private static readonly DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT = 1000;

  static withCacheSize(cacheSize: number): LruParams {
    return new LruParams(
      cacheSize,
      LruParams.DEFAULT_COLLECTION_PERCENTILE,
      LruParams.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT
    );
  }

  static readonly DEFAULT: LruParams = new LruParams(
    LRU_DEFAULT_CACHE_SIZE_BYTES,
    LruParams.DEFAULT_COLLECTION_PERCENTILE,
    LruParams.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT
  );

  static readonly DISABLED: LruParams = new LruParams(
    LRU_COLLECTION_DISABLED,
    0,
    0
  );

  constructor(
    // When we attempt to collect, we will only do so if the cache size is greater than this
    // threshold. Passing `COLLECTION_DISABLED` here will cause collection to always be skipped.
    readonly cacheSizeCollectionThreshold: number,
    // The percentage of sequence numbers that we will attempt to collect
    readonly percentileToCollect: number,
    // A cap on the total number of sequence numbers that will be collected. This prevents
    // us from collecting a huge number of sequence numbers if the cache has grown very large.
    readonly maximumSequenceNumbersToCollect: number
  ) {}
}

export interface LruGarbageCollector {
  readonly params: LruParams;

  collect(
    txn: PersistenceTransaction,
    activeTargetIds: ActiveTargets
  ): PersistencePromise<LruResults>;

  /** Given a percentile of target to collect, returns the number of targets to collect. */
  calculateTargetCount(
    txn: PersistenceTransaction,
    percentile: number
  ): PersistencePromise<number>;

  /** Returns the nth sequence number, counting in order from the smallest. */
  nthSequenceNumber(
    txn: PersistenceTransaction,
    n: number
  ): PersistencePromise<number>;

  /**
   * Removes documents that have a sequence number equal to or less than the upper bound and are not
   * otherwise pinned.
   */
  removeOrphanedDocuments(
    txn: PersistenceTransaction,
    upperBound: ListenSequenceNumber
  ): PersistencePromise<number>;

  getCacheSize(txn: PersistenceTransaction): PersistencePromise<number>;

  /**
   * Removes targets with a sequence number equal to or less than the given upper bound, and removes
   * document associations with those targets.
   */
  removeTargets(
    txn: PersistenceTransaction,
    upperBound: ListenSequenceNumber,
    activeTargetIds: ActiveTargets
  ): PersistencePromise<number>;
}

/**
 * Describes the results of a garbage collection run. `didRun` will be set to
 * `false` if collection was skipped (either it is disabled or the cache size
 * has not hit the threshold). If collection ran, the other fields will be
 * filled in with the details of the results.
 */
export interface LruResults {
  readonly didRun: boolean;
  readonly sequenceNumbersCollected: number;
  readonly targetsRemoved: number;
  readonly documentsRemoved: number;
}

/**
 * Persistence layers intending to use LRU Garbage collection should have reference delegates that
 * implement this interface. This interface defines the operations that the LRU garbage collector
 * needs from the persistence layer.
 */
export interface LruDelegate {
  readonly garbageCollector: LruGarbageCollector;

  /** Enumerates all the targets in the TargetCache. */
  forEachTarget(
    txn: PersistenceTransaction,
    f: (target: TargetData) => void
  ): PersistencePromise<void>;

  getSequenceNumberCount(
    txn: PersistenceTransaction
  ): PersistencePromise<number>;

  /**
   * Enumerates sequence numbers for documents not associated with a target.
   * Note that this may include duplicate sequence numbers.
   */
  forEachOrphanedDocumentSequenceNumber(
    txn: PersistenceTransaction,
    f: (sequenceNumber: ListenSequenceNumber) => void
  ): PersistencePromise<void>;

  /**
   * Removes all targets that have a sequence number less than or equal to `upperBound`, and are not
   * present in the `activeTargetIds` set.
   *
   * @returns the number of targets removed.
   */
  removeTargets(
    txn: PersistenceTransaction,
    upperBound: ListenSequenceNumber,
    activeTargetIds: ActiveTargets
  ): PersistencePromise<number>;

  /**
   * Removes all unreferenced documents from the cache that have a sequence number less than or
   * equal to the given `upperBound`.
   *
   * @returns the number of documents removed.
   */
  removeOrphanedDocuments(
    txn: PersistenceTransaction,
    upperBound: ListenSequenceNumber
  ): PersistencePromise<number>;

  getCacheSize(txn: PersistenceTransaction): PersistencePromise<number>;
}

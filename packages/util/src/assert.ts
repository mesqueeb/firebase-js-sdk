/**
 * @license
 * Copyright 2017 Google LLC
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
 * Throws an error if the provided assertion is falsy
 */
export const assert = function (assertion: unknown, message: string): void {
  if (!assertion) {
    fail(message);
  }
};

export function fail(failure: string = 'Unexpected state'): never {
  const message = 'Firebase INTERNAL ASSERT FAILED: ' + failure;
  console.error(message);
  throw Error(message);
}

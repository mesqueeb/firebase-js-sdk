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

import { spawn } from 'child-process-promise';
import { mapWorkspaceToPackages } from '../release/utils/workspace';
import { projectRoot } from '../utils';
import fs from 'fs';
import glob from 'glob';
import { join } from 'path';
import * as yargs from 'yargs';

/**
 * Add to devsite files to alert anyone trying to make a documentation fix
 * to the generated files.
 */
const GOOGLE3_HEADER = `
{% comment %}
DO NOT EDIT THIS FILE!
This is generated by the JS SDK team, and any local changes will be
overwritten. Changes should be made in the source code at
https://github.com/firebase/firebase-js-sdk
{% endcomment %}
`;

const tmpDir = `${projectRoot}/temp`;
const EXCLUDED_PACKAGES = ['app-compat', 'util', 'rules-unit-testing'];

yargs
  .command(
    '$0',
    'generate standard reference docs',
    {
      skipBuild: {
        type: 'boolean',
        default: false
      }
    },
    _argv => generateDocs(/* forDevsite */ false, _argv.skipBuild)
  )
  .command(
    'devsite',
    'generate reference docs for devsite',
    {
      skipBuild: {
        type: 'boolean',
        default: false
      }
    },
    _argv => generateDocs(/* forDevsite */ true, _argv.skipBuild)
  )
  .command('toc', 'generate devsite TOC', {}, _argv => generateToc())
  .option('skipBuild', {
    describe:
      'Skip yarn build and api-report - only do this if you have already generated the most up to date .api.json files',
    type: 'boolean'
  })
  .demandCommand()
  .help().argv;

async function generateToc() {
  console.log(`Temporarily renaming excluded packages' json files.`);
  for (const excludedPackage of EXCLUDED_PACKAGES) {
    if (fs.existsSync(`${projectRoot}/temp/${excludedPackage}.api.json`)) {
      fs.renameSync(
        `${projectRoot}/temp/${excludedPackage}.api.json`,
        `${projectRoot}/temp/${excludedPackage}.skip`
      );
    }
  }
  await spawn(
    'yarn',
    [
      'api-documenter-devsite',
      'toc',
      '--input',
      'temp',
      '-p',
      'docs/reference/js',
      '-j'
    ],
    { stdio: 'inherit' }
  );
  console.log(`Restoring excluded packages' json files.`);
  for (const excludedPackage of EXCLUDED_PACKAGES) {
    if (fs.existsSync(`${projectRoot}/temp/${excludedPackage}.skip`)) {
      fs.renameSync(
        `${projectRoot}/temp/${excludedPackage}.skip`,
        `${projectRoot}/temp/${excludedPackage}.api.json`
      );
    }
  }
}

// create *.api.json files
async function generateDocs(
  forDevsite: boolean = false,
  skipBuild: boolean = false
) {
  const outputFolder = forDevsite ? 'docs-devsite' : 'docs';
  const command = forDevsite ? 'api-documenter-devsite' : 'api-documenter';

  // Use a special d.ts file for auth for doc gen only.
  const authApiConfigOriginal = fs.readFileSync(
    `${projectRoot}/packages/auth/api-extractor.json`,
    'utf8'
  );
  const authApiConfigModified = authApiConfigOriginal.replace(
    `"mainEntryPointFilePath": "<projectFolder>/dist/esm5/index.d.ts"`,
    `"mainEntryPointFilePath": "<projectFolder>/dist/esm5/index.doc.d.ts"`
  );
  fs.writeFileSync(
    `${projectRoot}/packages/auth/api-extractor.json`,
    authApiConfigModified
  );

  if (!skipBuild) {
    await spawn('yarn', ['build'], {
      stdio: 'inherit'
    });

    await spawn('yarn', ['api-report'], {
      stdio: 'inherit'
    });
  }

  // Restore original auth api-extractor.json contents.
  fs.writeFileSync(
    `${projectRoot}/packages/auth/api-extractor.json`,
    authApiConfigOriginal
  );

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }

  // TODO: Throw error if path doesn't exist once all packages add markdown support.
  const apiJsonDirectories = (
    await mapWorkspaceToPackages([`${projectRoot}/packages/*`])
  )
    .map(path => `${path}/temp`)
    .filter(path => fs.existsSync(path));

  for (const dir of apiJsonDirectories) {
    const paths = await new Promise<string[]>(resolve =>
      glob(`${dir}/*.api.json`, (err, paths) => {
        if (err) throw err;
        resolve(paths);
      })
    );

    if (paths.length === 0) {
      throw Error(`*.api.json file is missing in ${dir}`);
    }

    // there will be only 1 api.json file
    const fileName = paths[0].split('/').pop();
    fs.copyFileSync(paths[0], `${tmpDir}/${fileName}`);
  }

  await spawn(
    'yarn',
    [
      command,
      'markdown',
      '--input',
      'temp',
      '--output',
      outputFolder,
      '--project',
      'js',
      '--sort-functions'
    ],
    { stdio: 'inherit' }
  );

  if (forDevsite) {
    const mdFiles = fs.readdirSync(join(projectRoot, outputFolder));
    for (const mdFile of mdFiles) {
      const fullPath = join(projectRoot, outputFolder, mdFile);
      const content = fs.readFileSync(fullPath, 'utf-8');
      fs.writeFileSync(
        fullPath,
        content.replace('\n# ', `\n${GOOGLE3_HEADER}\n# `)
      );
    }
  }

  await moveRulesUnitTestingDocs(outputFolder, command);
  await removeExcludedDocs(outputFolder);
}

async function removeExcludedDocs(mainDocsFolder: string) {
  console.log('Removing excluded docs from', EXCLUDED_PACKAGES.join(', '));
  for (const excludedPackage of EXCLUDED_PACKAGES) {
    const excludedMdFiles = await new Promise<string[]>(resolve =>
      glob(`${mainDocsFolder}/${excludedPackage}.*`, (err, paths) => {
        if (err) throw err;
        resolve(paths);
      })
    );
    console.log('glob pattern', `${mainDocsFolder}/${excludedPackage}.*`);
    for (const excludedMdFile of excludedMdFiles) {
      fs.unlinkSync(excludedMdFile);
    }
  }
}

// Create a docs-rut folder and move rules-unit-testing docs into it.
async function moveRulesUnitTestingDocs(
  mainDocsFolder: string,
  command: string
) {
  const rulesOutputFolder = `${projectRoot}/docs-rut`;

  console.log('Moving RUT docs to their own folder:', rulesOutputFolder);

  if (!fs.existsSync(rulesOutputFolder)) {
    fs.mkdirSync(rulesOutputFolder);
  }

  const rulesDocPaths = await new Promise<string[]>(resolve =>
    glob(`${mainDocsFolder}/rules-unit-testing.*`, (err, paths) => {
      if (err) throw err;
      resolve(paths);
    })
  );
  // Move rules-unit-testing docs into the new folder.
  // These paths also need to be adjusted to point to a sibling directory.
  for (const sourcePath of rulesDocPaths) {
    let destinationPath = sourcePath.replace(mainDocsFolder, rulesOutputFolder);

    const originalText = fs.readFileSync(sourcePath, 'utf-8');
    const jsReferencePath = '/docs/reference/js';
    let alteredPathText = originalText.replace(
      /\.\/database/g,
      `${jsReferencePath}/database`
    );
    alteredPathText = alteredPathText.replace(
      /\.\/storage/g,
      `${jsReferencePath}/storage`
    );
    alteredPathText = alteredPathText.replace(
      /\.\/firestore/g,
      `${jsReferencePath}/firestore`
    );
    fs.writeFileSync(destinationPath, alteredPathText);
  }
}

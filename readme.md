# S3 Object Data Mappper

![S3 ODM Banner](https://user-images.githubusercontent.com/3441017/168467257-78a0448b-2a3c-426f-9c99-54b606bc7a1b.png)

[![Version](https://badge.fury.io/gh/hisorange%2Fs3odm.svg)](https://badge.fury.io/gh/hisorange%2Fs3odm)
[![Build](https://github.com/hisorange/s3odm/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hisorange/s3odm/actions/workflows/ci.yml)
[![NPM](https://img.shields.io/npm/dt/@hisorange/s3odm?label=NPM)](https://www.npmjs.com/package/@hisorange/s3odm)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/hisorange/s3odm)](https://github.com/hisorange/s3odm/commits/main)
[![GitHub License](https://img.shields.io/github/license/hisorange/s3odm)](https://github.com/hisorange/s3odm/blob/main/LICENSE)

Just a super light weight "client", currently only implements a handful of interactions.
It's main goal to provide a non bloated way to interact with S3 buckets.

## Getting Started

```sh
yarn add @hisorange/s3odm
# Or
npm i @hisorange/s3odm
```

## Example Usage

```typescript
import { S3ODM } from '@hisorange/s3odm';

const ACCESS_KEY = 'XXXXX';
const SECRET_KEY = 'XXXXY';
const DOMAIN = '994b72fa8e67bc4167137357a2dd8763.r2.cloudflarestorage.com';
const BUCKET = 'my-database';

const odm = new S3ODM(ACCESS_KEY, SECRET_KEY, DOMAIN, BUCKET);

(async () => {
  const V_TABLE = 'users';

  // Create new document from POJOs
  await odm.insert(V_TABLE, 521, {
    name: 'Jane Doe',
    email: 'jane@does.com',
  });

  // Read the document
  await odm.findById(V_TABLE, 521);

  // Scan the bucket for object identifiers
  const userIds = await odm.listIds(V_TABLE);

  for (const userId of userIds) {
    await odm.findById(V_TABLE, userId);
  }
})();
```

# S3 Object Data Mappper

![S3 ODM Banner](https://user-images.githubusercontent.com/3441017/168467257-78a0448b-2a3c-426f-9c99-54b606bc7a1b.png)

[![Version](https://badge.fury.io/gh/hisorange%2Fs3odm.svg)](https://badge.fury.io/gh/hisorange%2Fs3odm)
[![Build](https://github.com/hisorange/s3odm/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hisorange/s3odm/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/hisorange/s3odm/badge.svg?branch=main)](https://coveralls.io/github/hisorange/s3odm?branch=main)
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
import { S3ODM, Document } from '@hisorange/s3odm';

const ACCESS_KEY = 'XXXXX';
const SECRET_KEY = 'XXXXY';
const DOMAIN = '994b72fa8e67bc4167137357a2dd8763.r2.cloudflarestorage.com';
const BUCKET = 'my-database';

type User = {
  name: string;
  email: string;
  lastSeenAt: number;
} & Document;

const odm = new S3ODM(ACCESS_KEY, SECRET_KEY, DOMAIN, BUCKET);

(async () => {
  // Create a repository which maps the documents to a prefix within the bucket
  const repository = odm.createRepository<User>('users');

  // Create new document from POJOs
  await repository.insert({
    _id: 'd7205bbe-ec08-4b88-9e39-1d10ab37a065',
    name: 'Jane Doe',
    email: 'jane@does.com',
  });

  // Read a record by _id property
  await repository.findById('d7205bbe-ec08-4b88-9e39-1d10ab37a065');

  // Load every record with a single call
  for (const user of await repository.findAll()) {
    // Update existing records
    repository.update({
      ...user,
      lastSeenAt: Date.now(),
    });
  }
})();
```

### Magic _\_id_ property

Each document gets an _\_id_ property assigned on read / write time, the identifier is the same as the document's path name without the table as prefix.

### Ideology (Why)

S3 is a key value storage, but we always think about it as a file storage (as it's intended to be one). My problem was simple, the project I was working on had to store a set of JSON documents in a persistent and reliable storage, but it could not be a traditional database because the JSON files were the descriptors for the database.
And S3 is a perfect solution for this, you can use it as a cheap and reliable solution to manage sets of data. But of course only if the query performance is not a problem!

Please don't try to create an e-commerce site with S3 as database, it will be slow and expensive for that kind of load, but if you wanna store and work with data which is not often needed but has to be available and reliable, then enjoy this repository.It will abstract the S3 finickiness away from you, and provide a super lightweight client to do so.

Also I am well aware of the AWS S3 SDK library, but it is 4.08 MB at the time of writing, while this library is 9kb as it is.

One more thing, don't forget to be awesome! ^.^

### Versioning

From 1.0.0 to 1.1.0 the library will not follow the semantic versioning, the 1.1.0 is the first semantic release.

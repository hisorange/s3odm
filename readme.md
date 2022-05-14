# S3 Object Data Mappper

Just a super light weight "client", currently only implements a handful of interactions.
It's main goal to provide a non bloated way to interact with S3 buckets.

```typescript
import { S3ODM } from '@hisorange/s3odm';

const odm = new S3ODM({
  accessKey: 'XXXX',
  secretKey: 'XXXX',
  hostname: '994b72fa8e67bc4167137357a2dd8763.r2.cloudflarestorage.com',
  bucket: 'my-bucket',
});

(async () => {
  const users = await odm.scanObjects('users');

  for (const usr of users) {
    writeFileSync(basename(usr), await (await odm.getObject(usr)).json());
  }

  await odm.setObject('users/42.json', {
    email: 'example@dot.com',
  });
})();
```

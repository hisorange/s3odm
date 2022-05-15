import crypto from 'crypto';
import { HTMLRewriter } from 'html-rewriter-wasm';
import fetch, { Headers, HeadersInit, RequestInit, Response } from 'node-fetch';
import { URLSearchParams } from 'url';

type HttpMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
export type Document = {
  _id: string;
  [key: string]: any;
};

export class S3ODM {
  /**
   * Signer
   */
  protected certify: ReturnType<typeof createCertifier>;

  /**
   * Initialize the S3ODM instance
   */
  constructor(
    accessKey: string,
    secretKey: string,
    readonly hostname: string,
    readonly bucket: string,
  ) {
    this.certify = createCertifier({
      accessKey,
      secretKey,
    });
  }

  createRepository<T extends Document = Document>(
    vTable: string,
  ): Repository<T> {
    return new Repository<T>(this, vTable);
  }

  protected async execute(
    okCode: number,
    method: HttpMethods,
    vTable: string,
    body?: string | ArrayBuffer,
  ): Promise<Response> {
    const url = `https://${this.hostname}/${this.bucket}/${vTable}`;

    const request = await this.certify({
      method,
      url,
      body,
    });

    try {
      const reply = await fetch(url, request as any);

      switch (reply.status) {
        case okCode:
          return reply;
        case 403:
          throw new Error('Invalid authentication');
        case 404:
          throw new Error('Document does not exists');
        case 409:
          throw new Error('Conflicting input: ' + (await reply.text()));
        default:
          throw new Error(`Unhandled status [${reply.status}]`);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get an identified object
   */
  async findById(vTable: string, _id: string) {
    const document = (await (
      await this.execute(200, 'GET', `${vTable}/${_id}.json`)
    ).json()) as Document;

    if (document && !document?._id) {
      document._id = _id;
    }

    return document;
  }

  /**
   * Get an identified object
   */
  async exists(vTable: string, _id: string) {
    return await this.execute(200, 'HEAD', `${vTable}/${_id}.json`)
      .then(r => !!r)
      .catch(() => false); // TODO: check if it's good error
  }

  /**
   * Create a new object from the given string
   */
  async insert(vTable: string, _id: string, body: any) {
    return this.execute(200, 'PUT', `${vTable}/${_id}.json`, {
      _id,
      ...body,
    });
  }

  /**
   * Delete the object
   */
  async deleteById(vTable: string, _id: string) {
    return this.execute(204, 'DELETE', `${vTable}/${_id}.json`);
  }

  /**
   * Delete the object
   */
  async deleteByIds(vTable: string, _ids: string[]) {
    const body = `<Delete>${_ids
      .map(_id => `<Object><Key>${vTable}/${_id}</Key></Object>`)
      .join('')}</Delete>`;

    return this.execute(200, 'POST', '?delete', body);
  }

  /**
   * Scan a bucket with the prefix for IDs
   */
  async listIds(vTable: string): Promise<string[]> {
    const chunkSize = 1000;

    const _ids: string[] = [];
    let marker: string | false = false;
    const params = new URLSearchParams();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    if (!vTable.match(/\/$/)) {
      vTable += '/';
    }

    //params.set('delimiter', '/');
    //params.set('encoding-type', 'url');
    params.set('list-type', '2');
    params.set('max-keys', chunkSize.toString());
    params.set('prefix', vTable);

    let matches = 0;

    do {
      if (marker) {
        params.set('start-after', marker);
      }

      const reply = await this.execute(200, 'GET', '?' + params.toString());
      const xml = await reply.text();
      matches = 0;

      let output = '';
      const rewriter = new HTMLRewriter(outputChunk => {
        output += decoder.decode(outputChunk);
      });

      rewriter.on('key', {
        text(chunk) {
          if (chunk.text) {
            matches++;

            if (chunk.text !== vTable) {
              _ids.push(
                chunk.text.substring(vTable.length).replace(/\.json$/, ''),
              );
              marker = chunk.text;
            }
          }
        },
      });

      try {
        await rewriter.write(encoder.encode(xml));
        await rewriter.end();
      } finally {
        rewriter.free(); // Remember to free memory
      }
    } while (chunkSize === matches); // TODO: not the best implementation, it can give less, but need to do a second row check

    return _ids;
  }
}

/**
 * Create an URL signer function
 */
const createCertifier = ({
  accessKey,
  secretKey,
}: {
  accessKey: string;
  secretKey: string;
}) => {
  const encoder = new TextEncoder();
  const cache = new Map<string, ArrayBuffer>();
  const UNSIGNABLE_HEADERS = [
    'authorization',
    'content-type',
    'content-length',
    'user-agent',
    'presigned-expires',
    'expect',
    'x-amzn-trace-id',
    'range',
    'connection',
  ];

  const buff2hex = (buffer: ArrayBuffer) => {
    return Array.prototype.map
      .call(new Uint8Array(buffer), x => ('0' + x.toString(16)).slice(-2))
      .join('');
  };

  const sha256encode = async (content: any) => {
    return (crypto.webcrypto as any).subtle.digest(
      'SHA-256',
      typeof content === 'string' ? encoder.encode(content) : content,
    );
  };

  const encodeRFC3986 = (urlEncodedStr: string) => {
    return urlEncodedStr.replace(
      /[!'()*]/g,
      c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  };

  const createHMAC = async (key: string | ArrayBuffer, string: string) => {
    const cryptoKey = await (crypto.webcrypto as any).subtle.importKey(
      'raw',
      typeof key === 'string' ? encoder.encode(key) : key,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign'],
    );

    return (crypto.webcrypto as any).subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(string),
    );
  };

  return async ({
    method,
    url,
    baseHeaders,
    body,
  }: {
    method: HttpMethods;
    url: string;
    baseHeaders?: HeadersInit;
    body?: BodyInit | null;
  }): Promise<RequestInit> => {
    const SERVICE = 's3';
    const REGION = 'auto';

    const urlObject = new URL(url);
    const headers = new Headers(baseHeaders || {});
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');

    headers.delete('Host'); // Can't be set in insecure env anyway

    if (!headers.has('X-Amz-Content-Sha256')) {
      headers.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');
    }

    headers.set('X-Amz-Date', datetime);

    const signableHeaders = ['host', ...headers.keys()]
      .filter(header => !UNSIGNABLE_HEADERS.includes(header))
      .sort();

    const signedHeaders = signableHeaders.join(';');

    const canonicalHeaders = signableHeaders
      .map(
        header =>
          header +
          ':' +
          (header === 'host'
            ? urlObject.host
            : (headers.get(header) || '').replace(/\s+/g, ' ')),
      )
      .join('\n');

    const _datestr = datetime.slice(0, 8);
    const credentialString = [_datestr, REGION, SERVICE, 'aws4_request'].join(
      '/',
    );

    let encodedPath: string;

    try {
      encodedPath = decodeURIComponent(urlObject.pathname.replace(/\+/g, ' '));
    } catch (e) {
      encodedPath = urlObject.pathname;
    }

    encodedPath = encodeURIComponent(encodedPath).replace(/%2F/g, '/');
    encodedPath = encodeRFC3986(encodedPath);

    const seenKeys = new Set();
    const encodedSearch = [...urlObject.searchParams]
      .filter(([k]) => {
        if (!k) return false;
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);

        return true;
      })
      .map(pair => pair.map(p => encodeRFC3986(encodeURIComponent(p))))
      .sort(([k1, v1], [k2, v2]) =>
        k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0,
      )
      .map(pair => pair.join('='))
      .join('&');

    const cacheKey = [secretKey, _datestr, REGION, SERVICE].join();

    let kCredentials = cache.get(cacheKey);

    if (!kCredentials) {
      const kDate = await createHMAC('AWS4' + secretKey, _datestr);
      const region = await createHMAC(kDate, REGION);
      const kService = await createHMAC(region, SERVICE);
      kCredentials = await createHMAC(kService, 'aws4_request');

      cache.set(cacheKey, kCredentials as any);
    }

    let hashHeader = headers.get('X-Amz-Content-Sha256');

    if (hashHeader == null) {
      if (body && typeof body !== 'string' && !('byteLength' in body)) {
        throw new Error(
          'body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header',
        );
      }

      hashHeader = buff2hex(await sha256encode(body || ''));
    }

    headers.set(
      'Authorization',
      [
        'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialString,
        'SignedHeaders=' + signedHeaders,
        'Signature=' +
          buff2hex(
            await createHMAC(
              kCredentials as any,
              [
                'AWS4-HMAC-SHA256',
                datetime,
                credentialString,
                buff2hex(
                  await sha256encode(
                    [
                      method,
                      encodedPath,
                      encodedSearch,
                      canonicalHeaders + '\n',
                      signedHeaders,
                      hashHeader,
                    ].join('\n'),
                  ),
                ),
              ].join('\n'),
            ),
          ),
      ].join(', '),
    );

    return {
      method,
      headers,
      body,
    } as RequestInit;
  };
};

/**
 * Repository for managing the document actions.
 */
class Repository<D extends Document = Document> {
  constructor(readonly driver: S3ODM, readonly tableName: string) {}

  /**
   * Delete a record from the table by it's identifier.
   */
  async deleteById(_id: string) {
    return (await this.driver.deleteById(this.tableName, _id)).json();
  }

  /**
   * Delete every record from the table.
   */
  async deleteAll(): Promise<string[]> {
    const _ids: string[] = await this.driver.listIds(this.tableName);

    if (_ids.length) {
      await this.driver.deleteByIds(this.tableName, _ids);
    }

    return _ids ?? [];
  }

  /**
   * Create a new record in the table.
   * Generates a UUID for the record if none is provided.
   */
  async insert(document: Partial<D>, _id?: string): Promise<D> {
    if (!_id) {
      if (document?._id) {
        _id = document._id;
      } else {
        _id = toUUID((Date.now() + Math.random()).toString());
      }
    }

    return (await (
      await this.driver.insert(this.tableName, _id, document)
    ).json()) as D;
  }

  /**
   * Update an existing record in the table.
   */
  async update(document: D, _id?: string): Promise<D> {
    if (!_id) {
      _id = document._id;
    }

    if (!(await this.driver.exists(this.tableName, _id))) {
      throw new Error(`Record with id ${_id} does not exist`);
    }

    return (await (
      await this.driver.insert(this.tableName, _id, document)
    ).json()) as D;
  }

  /**
   * Find a record by it's identifier.
   */
  async findById(_id: string): Promise<D | null> {
    try {
      return (await this.driver.findById(this.tableName, _id)) as D;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find all records in the table.
   */
  async findAll(): Promise<D[]> {
    const documents = [];

    for (const id of await this.driver.listIds(this.tableName)) {
      documents.push(this.findById(id));
    }

    return (await Promise.all(documents)).filter(Boolean) as D[];
  }
}

export const toUUID = function (input: string): string {
  return crypto
    .createHash('sha1')
    .update(input)
    .digest('hex')
    .toString()
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).+$/, '$1-$2-$3-$4-$5');
};

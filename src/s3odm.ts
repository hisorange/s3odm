import { createHash, webcrypto } from 'crypto';
import { HTMLRewriter } from 'html-rewriter-wasm';
import fetch, { Headers, HeadersInit, RequestInit, Response } from 'node-fetch';
import { URLSearchParams } from 'url';

class HttpException extends Error {
  constructor(readonly code: number) {
    super(`HTTP Error ${code}`);
  }
}

type HttpMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';

export interface Document {
  [key: string]: string | null | number | Array<unknown> | boolean | object;
  _id: string;
}

export class S3ODM {
  /**
   * Certifier instance
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
    region: string = 'auto',
  ) {
    this.certify = createCertifier({
      accessKey,
      secretKey,
      _region: region,
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
    body?: string,
  ): Promise<Response> {
    const url = `https://${this.hostname}/${this.bucket}/${vTable}`;

    const request = await this.certify({
      method,
      url,
      body,
    });

    const reply = await fetch(url, request as any);

    if (reply.status === okCode) {
      return reply;
    }

    throw new HttpException(reply.status);
  }

  /**
   * Fetch a JSON object by its identifier
   */
  async findById(vTable: string, _id: string): Promise<Document | null> {
    try {
      const document = (await (
        await this.execute(200, 'GET', `${vTable}/${_id}.json`)
      ).json()) as Document;

      if (document && !document?._id) {
        document._id = _id;
      }

      return document;
    } catch (error) {
      // Missing document, handle simply by returning a null
      if (error instanceof HttpException && error.code === 404) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Check if the given object exists with the given identifier
   */
  async exists(vTable: string, _id: string): Promise<boolean> {
    return await this.execute(200, 'HEAD', `${vTable}/${_id}.json`)
      .then(r => !!r)
      .catch(() => false);
  }

  /**
   * Create a new object
   */
  async insert(vTable: string, document: Document): Promise<Document> {
    await this.execute(
      200,
      'PUT',
      `${vTable}/${document._id}.json`,
      JSON.stringify(document),
    );

    return document;
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
      const rewriter = new HTMLRewriter((outputChunk: BufferSource) => {
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

  /**
   * Scan a bucket for prefixes
   */
  async listTables(): Promise<string[]> {
    const chunkSize = 1000;

    const _tables: string[] = [];
    let marker: string | false = false;
    const params = new URLSearchParams();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    params.set('list-type', '2');
    params.set('max-keys', chunkSize.toString());
    params.set('prefix', '');
    params.set('delimiter', '/');

    let matches = 0;

    do {
      if (marker) {
        params.set('start-after', marker);
      }

      const reply = await this.execute(200, 'GET', '?' + params.toString());
      const xml = await reply.text();
      matches = 0;

      let output = '';
      const rewriter = new HTMLRewriter((outputChunk: BufferSource) => {
        output += decoder.decode(outputChunk);
      });

      rewriter.on('Prefix', {
        text(chunk) {
          if (chunk.text) {
            matches++;

            _tables.push(chunk.text.replace(/\/$/, ''));

            marker = chunk.text;
          }
        },
      });

      try {
        await rewriter.write(encoder.encode(xml));
        await rewriter.end();
      } finally {
        rewriter.free(); // Remember to free memory
      }
    } while (chunkSize === matches);

    return _tables;
  }
}

type ICertifierConfig = {
  accessKey: string;
  secretKey: string;
  _region: string;
};

type ICertifierInput = {
  method: HttpMethods;
  url: string;
  baseHeaders?: HeadersInit;
  body?: BodyInit | null;
};

/**
 * Create an URL signer function
 */
const createCertifier = ({
  accessKey,
  secretKey,
  _region,
}: ICertifierConfig) => {
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
    return (webcrypto as any).subtle.digest(
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
    const cryptoKey = await (webcrypto as any).subtle.importKey(
      'raw',
      typeof key === 'string' ? encoder.encode(key) : key,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign'],
    );

    return (webcrypto as any).subtle.sign(
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
  }: ICertifierInput): Promise<RequestInit> => {
    const SERVICE = 's3';

    const urlObject = new URL(url);
    const headers = new Headers(baseHeaders || {});
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');

    headers.delete('Host');

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
    const credentialString = [_datestr, _region, SERVICE, 'aws4_request'].join(
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

    const cacheKey = [secretKey, _datestr, _region, SERVICE].join();

    let kCredentials = cache.get(cacheKey);

    if (!kCredentials) {
      const kDate = await createHMAC('AWS4' + secretKey, _datestr);
      const region = await createHMAC(kDate, _region);
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
export class Repository<D extends Document = Document> {
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
  async insert(document: D | Omit<D, '_id'>): Promise<D> {
    // Generate a random UUID if none is provided
    if (!document?._id) {
      document._id = toUUID((Date.now() + Math.random()).toString());
    }

    if (await this.driver.exists(this.tableName, document._id as string)) {
      throw new Error(`Record with _id [${document._id}] already exists`);
    }

    return (await this.driver.insert(
      this.tableName,
      document as Document,
    )) as D;
  }

  /**
   * Update an existing record in the table.
   */
  async update(document: D): Promise<D> {
    if (!(await this.driver.exists(this.tableName, document._id))) {
      throw new Error(`Record with _id [${document._id}] does not exist`);
    }

    return (await this.driver.insert(this.tableName, document)) as D;
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

export const toUUID = (input: string): string =>
  createHash('sha1')
    .update(input)
    .digest('hex')
    .toString()
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).+$/, '$1-$2-$3-$4-$5');

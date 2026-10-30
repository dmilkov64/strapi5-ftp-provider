import type { ReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { Client, type AccessOptions, FileType } from 'basic-ftp';

declare const strapi: { log: { warn: (msg: string) => void } };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FtpProviderConfig extends AccessOptions {
    /** Absolute base path on the FTP server, e.g. "/var/www/uploads" */
    basePath?: string;
    /** Public URL prefix, e.g. "https://cdn.example.com" */
    publicUrl: string;
}

interface FileFormat {
    name: string;
    hash: string;
    ext: string;
    mime: string;
    path: string | null;
    width: number;
    height: number;
    size: number;
    sizeInBytes: number;
    url: string;
}

interface StrapiFile {
    name: string;
    alternativeText?: string;
    caption?: string;
    width?: number;
    height?: number;
    formats?: Record<string, FileFormat>;
    hash: string;
    ext?: string;
    mime: string;
    size: number;
    sizeInBytes: number;
    url: string;
    previewUrl?: string;
    path?: string;
    provider?: string;
    provider_metadata?: Record<string, unknown>;
    stream?: ReadStream;
    buffer?: Buffer;
    createdAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a two-level sharded path from a file hash: "ab/cd" */
function buildShardPath(hash: string): string {
    const bare = hash.split('_').pop() ?? hash;
    return `${bare.substring(0, 2)}/${bare.substring(2, 4)}`;
}

/** Full server-side directory for a given file/format entry */
function getUploadPath(
    basePath: string | undefined,
    file: Pick<StrapiFile | FileFormat, 'hash'>,
): string {
    const shards = buildShardPath(file.hash);
    return [basePath, shards]
        .filter((p): p is string => Boolean(p?.trim()))
        .join('/');
}

/** "<hash><ext>" filename on the server */
function getFilename(file: Pick<StrapiFile | FileFormat, 'hash' | 'ext'>): string {
    return `${file.hash}${file.ext ?? ''}`;
}

// ---------------------------------------------------------------------------
// FTP client factory
// ---------------------------------------------------------------------------

async function createClient(options: AccessOptions): Promise<Client> {
    const client = new Client();
    await client.access(options);
    return client;
}

// ---------------------------------------------------------------------------
// Directory utilities
// ---------------------------------------------------------------------------

/**
 * Navigate into `path`, creating any missing directories along the way.
 * The client's CWD after the call equals `path`.
 */
async function ensureDirectories(client: Client, path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean);

    for (const segment of segments) {
        const list = await client.list();
        const exists = list.some(
            (item) => item.name === segment && item.type === FileType.Directory,
        );

        if (!exists) {
            try {
                await client.send(`MKD ${segment}`);
            } catch (err: unknown) {
                // 550 = directory already exists (race condition) — safe to ignore
                if (!isFtpError(err, 550)) throw err;
            }
        }

        await client.cd(segment);
    }
}

/**
 * Recursively remove the current directory if it is empty, then go up and
 * repeat. Stops at the server root.
 */
async function pruneEmptyDirectories(client: Client): Promise<void> {
    const contents = (await client.list()).filter(
        (i) => i.name !== '.' && i.name !== '..',
    );

    if (contents.length > 0) return;

    const pwd = (await client.pwd()).replace(/"/g, '');
    const segments = pwd.split('/').filter(Boolean);

    if (segments.length === 0) return;

    const dirname = segments[segments.length - 1];
    await client.cdup();
    await client.send(`RMD ${dirname}`);
    await pruneEmptyDirectories(client);
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function isFtpError(err: unknown, code: number): boolean {
    return err instanceof Error && err.message.includes(String(code));
}

function toUploadError(err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    return new Error(`FTP upload failed: ${msg}`);
}

function toDeleteError(err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    return new Error(`FTP delete failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const provider = {
    init(config: FtpProviderConfig) {
        const { publicUrl, basePath, ...accessOptions } = config;

        async function uploadFile(client: Client, file: StrapiFile): Promise<void> {
            const dir = getUploadPath(basePath, file);
            const filename = getFilename(file);

            await ensureDirectories(client, dir);

            const data: Readable = file.stream ?? Readable.from(file.buffer!);
            await client.uploadFrom(data, filename);

            file.url = `${publicUrl}/${dir}/${filename}`;
        }

        return {
            async upload(file: StrapiFile): Promise<void> {
                const client = await createClient(accessOptions);
                try {
                    await uploadFile(client, file);
                } catch (err) {
                    throw toUploadError(err);
                } finally {
                    client.close();
                }
            },

            async uploadStream(file: StrapiFile): Promise<void> {
                return this.upload(file);
            },

            async delete(file: StrapiFile): Promise<void> {
                const dir = getUploadPath(basePath, file);
                const client = await createClient(accessOptions);

                try {
                    await client.cd(dir);

                    // Delete the main file and all resized format variants
                    const targets: Pick<StrapiFile | FileFormat, 'hash' | 'ext'>[] = [
                        file,
                        ...Object.values(file.formats ?? {}),
                    ];

                    for (const t of targets) {
                        try {
                            await client.remove(getFilename(t));
                        } catch (err) {
                            if (!isFtpError(err, 550)) {
                                throw err;
                            }
                        }
                    }

                    await pruneEmptyDirectories(client);
                } catch (err: unknown) {
                    if (isFtpError(err, 550)) {
                        strapi.log.warn(
                            `FTP provider: path not found, skipping delete → ${dir}`,
                        );
                        return;
                    }
                    throw toDeleteError(err);
                } finally {
                    client.close();
                }
            },
        };
    },
};

export = provider;

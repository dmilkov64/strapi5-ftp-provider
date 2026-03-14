# Strapi 5 FTP Upload Provider

A Strapi v5 upload provider that stores files on an FTP server and exposes them via a public URL.

## Features

- Uploads files and all image format variants (thumbnail, small, medium, large) to an FTP server
- Organizes files into a two-level hash-sharded directory tree (`ab/cd/`) to avoid large flat directories
- Automatically creates missing directories on upload
- Cleans up empty directories after deletion
- Works with both plain FTP and FTPS (`secure: true`)

## Requirements

- Strapi v5
- Node.js ≥ 18

## Installation

```bash
# npm
npm install strapi5-ftp-provider

# yarn
yarn add strapi5-ftp-provider
```

## Configuration

### `config/plugins.ts`

```ts
export default ({ env }) => ({
  upload: {
    config: {
      provider: 'strapi5-ftp-provider',
      providerOptions: {
        host:      env('UPLOAD_FTP_HOST'),
        port:      env.int('UPLOAD_FTP_PORT', 21),
        user:      env('UPLOAD_FTP_USER'),
        password:  env('UPLOAD_FTP_PASSWORD'),
        publicUrl: env('UPLOAD_FTP_PUBLIC_URL'),
        basePath:  env('UPLOAD_FTP_BASE_PATH'),
        secure:    env.bool('UPLOAD_FTP_SECURE', false),
        passive:   env.bool('UPLOAD_FTP_PASSIVE', true),
      },
    },
  },
});
```

### `.env`

```env
UPLOAD_FTP_HOST=ftp.example.com
UPLOAD_FTP_PORT=21
UPLOAD_FTP_USER=ftp-user
UPLOAD_FTP_PASSWORD=secret
UPLOAD_FTP_PUBLIC_URL=https://cdn.example.com
UPLOAD_FTP_BASE_PATH=/var/www/uploads
UPLOAD_FTP_SECURE=false
UPLOAD_FTP_PASSIVE=true
```

### `config/middlewares.ts`

Add the public URL to the Content Security Policy so Strapi Admin can display the uploaded files:

```ts
export default [
  // ...
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.example.com'],
        },
      },
    },
  },
];
```

## Provider options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | `string` | ✅ | — | FTP server hostname |
| `port` | `number` | | `21` | FTP server port |
| `user` | `string` | ✅ | — | FTP username |
| `password` | `string` | ✅ | — | FTP password |
| `publicUrl` | `string` | ✅ | — | Public URL prefix used to build file URLs, e.g. `https://cdn.example.com` |
| `basePath` | `string` | | — | Absolute base path on the server, e.g. `/var/www/uploads`. Omit if the FTP user lands directly in the web root |
| `secure` | `boolean` | | `false` | Use FTPS (explicit TLS) |
| `passive` | `boolean` | | `true` | Use passive mode |

All options are passed directly to [`basic-ftp`](https://github.com/patrickjuchli/basic-ftp), so any additional `AccessOptions` fields (e.g. `secureOptions`) are also supported.

## How files are stored

Given `publicUrl = https://cdn.example.com` and `basePath = /var/www/uploads`, a file with hash `abcdef1234` and extension `.jpg` is stored at:

```
/var/www/uploads/ab/cd/abcdef1234.jpg
```

and served at:

```
https://cdn.example.com/ab/cd/abcdef1234.jpg
```

## License

MIT

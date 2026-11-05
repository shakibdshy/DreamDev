# Member photos stored in Vercel Blob

Member photos go to Vercel Blob, not the database or local disk. The app deploys to Vercel (ephemeral filesystem), so disk is not an option, and base64-in-Postgres would bloat every member list query. Vercel Blob keeps storage inside the existing deployment vendor: one token, signed uploads, public URLs stored on the member row.

Client resizes to a 512px square before uploading (accept JPEG/PNG/WebP, ~2 MB cap); only Admin and Editor may upload.

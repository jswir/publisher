/**
 * Whether a package `location` is a remote URI that reload would re-fetch.
 * Local-dir packages (absolute / relative / `~/`) may be edited in place;
 * github / gcs / s3 may not — a later reload would overwrite the write.
 */
export function isRemotePackageLocation(
   location: string | undefined | null,
): boolean {
   if (typeof location !== "string") return false;
   const loc = location.trim();
   if (loc.length === 0) return false;
   return (
      loc.startsWith("https://") ||
      loc.startsWith("http://") ||
      loc.startsWith("git@") ||
      loc.startsWith("gs://") ||
      loc.startsWith("s3://")
   );
}

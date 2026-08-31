import { describe, expect, it } from "bun:test";
import { isRemotePackageLocation } from "./package_location";

describe("isRemotePackageLocation", () => {
   it("treats missing and local paths as writable", () => {
      expect(isRemotePackageLocation(undefined)).toBe(false);
      expect(isRemotePackageLocation("")).toBe(false);
      expect(isRemotePackageLocation("/abs/pkg")).toBe(false);
      expect(isRemotePackageLocation("./examples/storefront")).toBe(false);
      expect(isRemotePackageLocation("../storefront")).toBe(false);
      expect(isRemotePackageLocation("~/code/pkg")).toBe(false);
   });

   it("rejects github, gcs, and s3", () => {
      expect(
         isRemotePackageLocation("https://github.com/malloydata/publisher"),
      ).toBe(true);
      expect(isRemotePackageLocation("http://example.com/pkg")).toBe(true);
      expect(isRemotePackageLocation("git@github.com:malloydata/publisher")).toBe(
         true,
      );
      expect(isRemotePackageLocation("gs://bucket/pkg")).toBe(true);
      expect(isRemotePackageLocation("s3://bucket/pkg")).toBe(true);
   });
});

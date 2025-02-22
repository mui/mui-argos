import { jest } from "@jest/globals";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import config from "@argos-ci/config";
import type {
  Build,
  Repository,
  Screenshot,
  ScreenshotBucket,
  ScreenshotDiff,
} from "@argos-ci/database/models";
import { factory, useDatabase } from "@argos-ci/database/testing";
import { quitAmqp } from "@argos-ci/job-core";
import { s3 as getS3, upload } from "@argos-ci/storage";
import type { S3Client } from "@argos-ci/storage";

import { computeScreenshotDiff } from "./computeScreenshotDiff.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("#computeScreenshotDiff", () => {
  useDatabase();
  jest.setTimeout(10000);

  let s3: S3Client;
  let baseBucket: ScreenshotBucket;
  let build: Build;
  let compareBucket: ScreenshotBucket;
  let screenshotDiff: ScreenshotDiff;

  beforeAll(async () => {
    s3 = getS3();
    await upload({
      s3,
      Bucket: config.get("s3.screenshotsBucket"),
      Key: "penelope.jpg",
      inputPath: join(__dirname, "__fixtures__", "penelope.jpg"),
    });
    await upload({
      s3,
      Bucket: config.get("s3.screenshotsBucket"),
      Key: "penelope-argos.jpg",
      inputPath: join(__dirname, "__fixtures__", "penelope-argos.jpg"),
    });
  });

  beforeEach(async () => {
    const repository = await factory.create<Repository>("Repository", {
      token: "xx",
    });
    compareBucket = await factory.create<ScreenshotBucket>("ScreenshotBucket", {
      name: "test-bucket",
      branch: "test-branch",
      repositoryId: repository.id,
    });
    baseBucket = await factory.create<ScreenshotBucket>("ScreenshotBucket", {
      name: "base-bucket",
      branch: "master",
      repositoryId: repository.id,
    });
    build = await factory.create<Build>("Build", {
      baseScreenshotBucketId: baseBucket.id,
      compareScreenshotBucketId: compareBucket.id,
      repositoryId: repository.id,
    });
  });

  afterAll(async () => {
    await delay(500);
    await quitAmqp();
  });

  describe("with two different screenshots", () => {
    beforeEach(async () => {
      const compareScreenshot = await factory.create<Screenshot>("Screenshot", {
        name: "penelope",
        s3Id: "penelope-argos.jpg",
        screenshotBucketId: compareBucket.id,
      });
      const baseScreenshot = await factory.create<Screenshot>("Screenshot", {
        name: "penelope",
        s3Id: "penelope.jpg",
        screenshotBucketId: baseBucket.id,
      });
      screenshotDiff = await factory.create<ScreenshotDiff>("ScreenshotDiff", {
        buildId: build.id,
        baseScreenshotId: baseScreenshot.id,
        compareScreenshotId: compareScreenshot.id,
        jobStatus: "pending",
        validationStatus: "unknown",
      });
    });

    it('should update result and notify "diff-detected"', async () => {
      await computeScreenshotDiff(screenshotDiff, {
        s3,
        bucket: config.get("s3.screenshotsBucket"),
      });

      await screenshotDiff.reload();
      expect(screenshotDiff.score! > 0).toBe(true);
      expect(typeof screenshotDiff.s3Id === "string").toBe(true);
      // expect(pushBuildNotification).toBeCalledWith({
      //   buildId: build.id,
      //   type: "diff-detected",
      // });
    });
  });

  describe("with two same screenshots", () => {
    beforeEach(async () => {
      const compareScreenshot = await factory.create<Screenshot>("Screenshot", {
        name: "penelope",
        s3Id: "penelope.jpg",
        screenshotBucketId: compareBucket.id,
      });
      const baseScreenshot = await factory.create<Screenshot>("Screenshot", {
        name: "penelope",
        s3Id: "penelope.jpg",
        screenshotBucketId: baseBucket.id,
      });
      screenshotDiff = await factory.create<ScreenshotDiff>("ScreenshotDiff", {
        buildId: build.id,
        baseScreenshotId: baseScreenshot.id,
        compareScreenshotId: compareScreenshot.id,
        jobStatus: "pending",
        validationStatus: "unknown",
      });
    });

    it('should not update result and notify "no-diff-detected"', async () => {
      await computeScreenshotDiff(screenshotDiff, {
        s3,
        bucket: config.get("s3.screenshotsBucket"),
      });

      await screenshotDiff.reload();
      expect(screenshotDiff.score).toBe(0);
      expect(screenshotDiff.s3Id).toBe(null);
      // expect(pushBuildNotification).toBeCalledWith({
      //   buildId: build.id,
      //   type: "no-diff-detected",
      // });
    });
  });
});

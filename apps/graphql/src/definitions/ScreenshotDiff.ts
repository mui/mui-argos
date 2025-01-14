import gqlTag from "graphql-tag";

import type { Screenshot, ScreenshotDiff } from "@argos-ci/database/models";
import { getPublicUrl } from "@argos-ci/storage";

import type { Context } from "../context.js";

// eslint-disable-next-line import/no-named-as-default-member
const { gql } = gqlTag;

const screenshotFailureRegexp = `(${Object.values({
  cypress: " \\(failed\\)\\.",
  playwright: "-failed-",
}).join("|")})`;

const getDiffStatus = async (
  screenshotDiff: ScreenshotDiff,
  _args: Record<string, never>,
  context: Context
) => {
  if (!screenshotDiff.compareScreenshotId) return "removed";

  if (!screenshotDiff.baseScreenshotId) {
    const { name } = await context.loaders.Screenshot.load(
      screenshotDiff.compareScreenshotId
    );
    return name.match(screenshotFailureRegexp) ? "failure" : "added";
  }

  return screenshotDiff.score && screenshotDiff.score > 0
    ? "changed"
    : "unchanged";
};

export const selectDiffStatus = `CASE \
    WHEN "compareScreenshotId" IS NULL \
      THEN 'removed' \
    WHEN "baseScreenshotId" IS NULL \
      AND "name" ~ '${screenshotFailureRegexp}' \
      THEN 'failure'  \
    WHEN "baseScreenshotId" IS NULL \
      THEN 'added' \
    WHEN "score" IS NOT NULL AND "score" > 0 \
      THEN 'changed' \
    ELSE 'unchanged'  \
  END \
  AS status`;

export const sortDiffByStatus = `CASE \
    WHEN "compareScreenshotId" IS NULL \
      THEN 3 -- removed
    WHEN "baseScreenshotId" IS NULL \
      AND "compareScreenshot"."name" ~ '${screenshotFailureRegexp}' \
      THEN 0 -- failure
    WHEN "baseScreenshotId" IS NULL  \
      THEN 2 -- added
    WHEN "score" IS NOT NULL AND "score" > 0 \
      THEN 1 -- changed
    ELSE 4 -- unchanged
  END ASC`;

export const typeDefs = gql`
  enum ScreenshotDiffStatus {
    added
    unchanged
    changed
    failure
    removed
  }

  type ScreenshotDiff implements Node {
    id: ID!
    createdAt: DateTime!
    baseScreenshot: Screenshot
    compareScreenshot: Screenshot
    url: String
    name: String!
    width: Int
    height: Int
    status: ScreenshotDiffStatus!
    validationStatus: String
  }

  type ScreenshotDiffConnection implements Connection {
    pageInfo: PageInfo!
    edges: [ScreenshotDiff!]!
  }
`;

export const resolvers = {
  ScreenshotDiff: {
    baseScreenshot: async (
      screenshotDiff: ScreenshotDiff,
      _args: Record<string, never>,
      context: Context
    ) => {
      if (!screenshotDiff.baseScreenshotId) return null;
      return context.loaders.Screenshot.load(screenshotDiff.baseScreenshotId);
    },
    compareScreenshot: async (
      screenshotDiff: ScreenshotDiff,
      _args: Record<string, never>,
      context: Context
    ) => {
      if (!screenshotDiff.compareScreenshotId) return null;
      return context.loaders.Screenshot.load(
        screenshotDiff.compareScreenshotId
      );
    },
    url: (screenshotDiff: ScreenshotDiff) => {
      if (!screenshotDiff.s3Id) return null;
      return getPublicUrl(screenshotDiff.s3Id);
    },
    name: async (
      screenshotDiff: ScreenshotDiff,
      _args: Record<string, never>,
      context: Context
    ) => {
      const [baseScreenshot, compareScreenshot] = await Promise.all([
        screenshotDiff.baseScreenshotId
          ? context.loaders.Screenshot.load(screenshotDiff.baseScreenshotId)
          : null,
        screenshotDiff.compareScreenshotId
          ? context.loaders.Screenshot.load(screenshotDiff.compareScreenshotId)
          : null,
      ]);
      const name = baseScreenshot?.name || compareScreenshot?.name;
      if (!name) {
        throw new Error("ScreenshotDiff without name");
      }
      return name;
    },
    width: async (
      screenshot: Screenshot,
      _args: Record<string, never>,
      context: Context
    ) => {
      if (!screenshot.fileId) return null;
      const file = await context.loaders.File.load(screenshot.fileId);
      return file.width;
    },
    height: async (
      screenshot: Screenshot,
      _args: Record<string, never>,
      context: Context
    ) => {
      if (!screenshot.fileId) return null;
      const file = await context.loaders.File.load(screenshot.fileId);
      return file.height;
    },
    status: getDiffStatus,
  },
};

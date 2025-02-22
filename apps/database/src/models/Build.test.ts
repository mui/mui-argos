import { factory, useDatabase } from "../testing/index.js";
import { Build } from "./Build.js";
import type { Repository, ScreenshotDiff, User } from "./index.js";

const baseData = {
  repositoryId: "1",
  baseScreenshotBucketId: "1",
  compareScreenshotBucketId: "2",
  jobStatus: "pending",
};

describe("models/Build", () => {
  useDatabase();

  describe("create build", () => {
    it("should add a build number", async () => {
      const build1 = await factory.create<Build>("Build");
      const build2 = await factory.create<Build>("Build", {
        repositoryId: build1.repositoryId,
      });
      expect(build1.number).toBe(1);
      expect(build2.number).toBe(2);
    });

    it("should be able to override the number", async () => {
      const build = await factory.create<Build>("Build", {
        number: 0,
      });
      expect(build.number).toBe(0);
    });
  });

  describe("patch build", () => {
    it("should not add a build number", async () => {
      const build = await factory.create<Build>("Build");
      expect(build.number).toBe(1);
      await build.$query().patch({ jobStatus: "complete" }).returning("*");
      await build.reload();
      expect(build.number).toBe(1);
      expect(build.jobStatus).toBe("complete");
    });
  });

  describe("validation screenshotBucket", () => {
    it("should throw if the screenshot buckets are the same", () => {
      expect(() => {
        Build.fromJson({
          ...baseData,
          compareScreenshotBucketId: "1",
        });
      }).toThrow(
        "The base screenshot bucket should be different to the compare one."
      );
    });

    it("should not throw if the screenshot buckets are different", () => {
      expect(() => {
        Build.fromJson(baseData);
      }).not.toThrow();
    });
  });

  describe("#getUsers", () => {
    let user: User;
    let build: Build;

    beforeEach(async () => {
      user = await factory.create<User>("User");
      const repository = await factory.create<Repository>("Repository");
      await factory.create("UserRepositoryRight", {
        userId: user.id,
        repositoryId: repository.id,
      });
      build = await factory.create<Build>("Build", {
        repositoryId: repository.id,
      });
    });

    it("should return users having rights on the repository", async () => {
      const users = await build.getUsers();
      expect(users.length === 1).toBe(true);
      expect(users[0]!.id).toBe(user.id);

      const staticUsers = await Build.getUsers(build.id);
      expect(staticUsers.length === 1).toBe(true);
      expect(staticUsers[0]!.id).toBe(user.id);
    });
  });

  describe("#getStatus", () => {
    let build;

    describe("with in progress job", () => {
      it("should be pending", async () => {
        build = await factory.create<Build>("Build", { jobStatus: "progress" });
        expect(await build.$getStatus()).toBe("pending");
      });
    });

    describe("with pending job", () => {
      it("should be pending", async () => {
        build = await factory.create<Build>("Build", { jobStatus: "pending" });
        expect(await build.$getStatus()).toBe("pending");
      });
    });

    describe("with old in progress job", () => {
      it("should be expired", async () => {
        build = await factory.create<Build>("Build", {
          jobStatus: "progress",
          createdAt: new Date(
            new Date().valueOf() - 3 * 3600 * 1000
          ).toISOString(),
        });
        expect(await build.$getStatus()).toBe("expired");
      });
    });

    describe("with old pending job", () => {
      it("should be expired", async () => {
        build = await factory.create<Build>("Build", {
          jobStatus: "pending",
          createdAt: new Date(
            new Date().valueOf() - 3 * 3600 * 1000
          ).toISOString(),
        });
        expect(await build.$getStatus()).toBe("expired");
      });
    });

    describe("with complete job", () => {
      describe("and one in error screenshot diff", () => {
        it("should be error", async () => {
          build = await factory.create<Build>("Build");
          await factory.createMany("ScreenshotDiff", [
            { buildId: build.id, jobStatus: "complete" },
            { buildId: build.id, jobStatus: "error" },
          ]);
          expect(await build.$getStatus()).toBe("error");
        });
      });

      describe("and one pending screenshot diff", () => {
        it("should be pending", async () => {
          build = await factory.create<Build>("Build");
          await factory.createMany("ScreenshotDiff", [
            { buildId: build.id, jobStatus: "complete" },
            { buildId: build.id, jobStatus: "pending" },
          ]);
          expect(await build.$getStatus()).toBe("progress");
        });
      });

      describe("and one in progress screenshot diff", () => {
        it("should be progress", async () => {
          build = await factory.create<Build>("Build");
          await factory.createMany("ScreenshotDiff", [
            { buildId: build.id, jobStatus: "complete" },
            { buildId: build.id, jobStatus: "progress" },
          ]);
          expect(await build.$getStatus()).toBe("progress");
        });
      });

      describe("with complete screenshot diffs", () => {
        it("should be error", async () => {
          build = await factory.create<Build>("Build");
          await factory.createMany("ScreenshotDiff", [
            { buildId: build.id, jobStatus: "complete" },
            { buildId: build.id, jobStatus: "complete" },
          ]);
          expect(await build.$getStatus()).toBe("complete");
        });
      });
    });

    describe("with aborted job", () => {
      it("should be aborted", async () => {
        build = await factory.create<Build>("Build", { jobStatus: "aborted" });
        expect(await build.$getStatus()).toBe("aborted");
      });
    });

    describe("with error job", () => {
      it("should be error", async () => {
        build = await factory.create<Build>("Build", { jobStatus: "error" });
        expect(await build.$getStatus()).toBe("error");
      });
    });
  });

  describe("#getStatuses", () => {
    it("should return ordered build statuses", async () => {
      const builds = await factory.createMany<Build>("Build", [
        { jobStatus: "pending" },
        { jobStatus: "progress" },
        { jobStatus: "complete" },
        { jobStatus: "error" },
        { jobStatus: "aborted" },
      ]);
      const statuses = await Build.getStatuses(builds);
      expect(statuses).toEqual([
        "pending",
        "pending",
        "complete",
        "error",
        "aborted",
      ]);
    });
  });

  describe("#getConclusions", () => {
    it("should return null for uncompleted jobs", async () => {
      const builds = await factory.createMany<Build>("Build", [
        { jobStatus: "pending" },
        { jobStatus: "progress" },
        { jobStatus: "error" },
        { jobStatus: "aborted" },
      ]);

      const statuses = await Build.getStatuses(builds);
      const conclusions = await Build.getConclusions(
        builds.map((b) => b.id),
        statuses
      );
      expect(conclusions).toEqual([null, null, null, null]);
    });

    it("should return 'stable' when empty", async () => {
      const build = await factory.create<Build>("Build", {
        jobStatus: "complete",
      });
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      expect(conclusions).toEqual(["stable"]);
    });

    it("should return 'stable' when no diff detected", async () => {
      const build = await factory.create<Build>("Build");
      await factory.createMany("ScreenshotDiff", [
        { buildId: build.id },
        { buildId: build.id },
      ]);
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      expect(conclusions).toEqual(["stable"]);
    });

    it("should return 'diff-detected' when diff are detected", async () => {
      const build = await factory.create<Build>("Build");
      await factory.createMany<ScreenshotDiff>("ScreenshotDiff", [
        { buildId: build.id },
        { buildId: build.id, score: 1.3 },
      ]);
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      expect(conclusions).toEqual(["diffDetected"]);
    });
  });

  describe("#reviewStatuses", () => {
    it("should return null for uncompleted jobs", async () => {
      const build = await factory.create<Build>("Build", {
        jobStatus: "pending",
      });
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      const reviewStatuses = await Build.getReviewStatuses(
        [build.id],
        conclusions
      );
      expect(reviewStatuses).toEqual([null]);
    });

    it("should return null for stable build", async () => {
      const builds = await factory.createMany<Build>("Build", 2);
      await factory.createMany("ScreenshotDiff", 2, { buildId: builds[0]!.id });
      await factory.createMany("ScreenshotDiff", 2, { buildId: builds[1]!.id });
      const statuses = await Build.getStatuses(builds);
      const conclusions = await Build.getConclusions(
        builds.map((b) => b.id),
        statuses
      );
      const reviewStatuses = await Build.getReviewStatuses(
        builds.map((b) => b.id),
        conclusions
      );
      expect(reviewStatuses).toEqual([null, null]);
    });

    it("should return 'accepted' when all diff are accepted", async () => {
      const build = await factory.create<Build>("Build");
      await factory.createMany("ScreenshotDiff", [
        { buildId: build.id, score: "1.3", validationStatus: "accepted" },
        { buildId: build.id, score: "0.4", validationStatus: "accepted" },
      ]);
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      const reviewStatuses = await Build.getReviewStatuses(
        [build.id],
        conclusions
      );
      expect(reviewStatuses).toEqual(["accepted"]);
    });

    it("should return 'rejected' when one diff is rejected", async () => {
      const build = await factory.create<Build>("Build");
      await factory.createMany("ScreenshotDiff", [
        { buildId: build.id, score: "1.3", validationStatus: "accepted" },
        { buildId: build.id, score: "0.4", validationStatus: "rejected" },
      ]);
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      const reviewStatuses = await Build.getReviewStatuses(
        [build.id],
        conclusions
      );
      expect(reviewStatuses).toEqual(["rejected"]);
    });

    it("should return null in other case", async () => {
      const build = await factory.create<Build>("Build");
      await factory.createMany("ScreenshotDiff", [
        { buildId: build.id, score: "1.3", validationStatus: "accepted" },
        { buildId: build.id, score: "0.4", validationStatus: "" },
      ]);
      const statuses = await Build.getStatuses([build]);
      const conclusions = await Build.getConclusions([build.id], statuses);
      const reviewStatuses = await Build.getReviewStatuses(
        [build.id],
        conclusions
      );
      expect(reviewStatuses).toEqual([null]);
    });
  });

  describe("#getUrl", () => {
    it("should return url", async () => {
      const build = await factory.create<Build>("Build");
      const url = await build.getUrl();
      expect(url).toMatch(
        `http://localhost:4001/${build.repository!.organization!.login}/${
          build.repository!.name
        }/builds/${build.number}`
      );
    });
  });
});

import axios from "axios";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";

// import { job as buildJob } from "@argos-ci/build";
import type { Organization, Repository } from "@argos-ci/database/models";
import { Build } from "@argos-ci/database/models";
import { factory, useDatabase } from "@argos-ci/database/testing";
import { quitAmqp } from "@argos-ci/job-core";
import { s3 } from "@argos-ci/storage";

import { createApp } from "./app.js";
import { quitRedis } from "./redis/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("api v2", () => {
  useDatabase();

  let app: Express.Application;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await Promise.all([quitRedis(), s3().destroy(), quitAmqp()]);
  });

  describe("POST /v2/builds", () => {
    describe("with no valid token", () => {
      it("should respond 401", async () => {
        await request(app)
          .post("/v2/builds")
          .set("Host", "api.argos-ci.dev")
          .set("Authorization", "Bearer nop")
          .expect((res) => {
            expect(res.body.error.message).toBe(
              `Repository not found (token: "nop")`
            );
          })
          .expect(401);
      });
    });

    describe("with valid repository", () => {
      let repository: Repository;

      beforeEach(async () => {
        const organization = await factory.create<Organization>(
          "Organization",
          {
            login: "argos-ci",
          }
        );
        repository = await factory.create<Repository>("Repository", {
          name: "argos",
          organizationId: organization.id,
          token: "awesome-token",
        });
      });

      it("creates build and upload urls", async () => {
        const res = await request(app)
          .post("/v2/builds")
          .set("Host", "api.argos-ci.dev")
          .set("Authorization", "Bearer awesome-token")
          .send({
            commit: "b6bf264029c03888b7fb7e6db7386f3b245b77b0",
            screenshotKeys: [
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
              "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589",
            ],
            branch: "main",
            name: "current",
          })
          // .end(console.log);
          .expect(201);

        const build = await Build.query()
          .withGraphFetched("compareScreenshotBucket")
          .first();

        if (!build) {
          throw new Error("Build not found");
        }

        expect(build.jobStatus).toBe("pending");
        expect(build.name).toBe("current");
        expect(build.repositoryId).toBe(repository.id);
        expect(build.externalId).toBe(null);
        expect(build.batchCount).toBe(null);
        expect(build.compareScreenshotBucket!.complete).toBe(false);
        expect(build.compareScreenshotBucket!.name).toBe("current");
        expect(build.compareScreenshotBucket!.commit).toBe(
          "b6bf264029c03888b7fb7e6db7386f3b245b77b0"
        );
        expect(build.compareScreenshotBucket!.branch).toBe("main");
        expect(build.compareScreenshotBucket!.repositoryId).toBe(repository.id);

        expect(res.body).toMatchObject({
          build: {
            id: build.id,
            url: await build.getUrl(),
          },
          screenshots: [
            {
              key: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
              putUrl: expect.any(String),
            },
            {
              key: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589",
              putUrl: expect.any(String),
            },
          ],
        });
      });
    });

    describe("complete workflow — single", () => {
      let repository: Repository;

      beforeEach(async () => {
        const organization = await factory.create<Organization>(
          "Organization",
          {
            login: "argos-ci",
          }
        );
        repository = await factory.create<Repository>("Repository", {
          name: "argos",
          organizationId: organization.id,
          token: "awesome-token",
        });
      });

      it("create a complete build", async () => {
        const screenshots = [
          {
            key: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            name: "first",
            path: join(__dirname, "__fixtures__", "screenshot_test.jpg"),
          },
          {
            key: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589",
            name: "second",
            path: join(__dirname, "__fixtures__", "screenshot_test_2.jpg"),
          },
          {
            key: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589",
            name: "second-twin",
            path: join(__dirname, "__fixtures__", "screenshot_test_2.jpg"),
          },
        ];
        const createResult = await request(app)
          .post("/v2/builds")
          .set("Host", "api.argos-ci.dev")
          .set("Authorization", "Bearer awesome-token")
          .send({
            commit: "b6bf264029c03888b7fb7e6db7386f3b245b77b0",
            screenshotKeys: Array.from(
              new Set(screenshots.map((screenshot) => screenshot.key))
            ),
            branch: "main",
            name: "current",
          })
          .expect(201);

        // Upload screenshots
        await Promise.all(
          createResult.body.screenshots.map(
            async (resScreenshot: { key: string; putUrl: string }) => {
              const path = screenshots.find(
                (s) => s.key === resScreenshot.key
              )!.path;
              const file = await readFile(path);

              const axiosResponse = await axios({
                method: "PUT",
                url: resScreenshot.putUrl,
                data: file,
                headers: {
                  "Content-Type": "image/jpeg",
                },
              });

              expect(axiosResponse.status).toBe(200);
            }
          )
        );

        const updateResult = await request(app)
          .put(`/v2/builds/${createResult.body.build.id}`)
          .set("Host", "api.argos-ci.dev")
          .set("Authorization", "Bearer awesome-token")
          .send({
            screenshots: screenshots.map((screenshot) => ({
              key: screenshot.key,
              name: screenshot.name,
            })),
          })
          .expect(200);

        const build = await Build.query()
          .withGraphFetched("compareScreenshotBucket.screenshots.file")
          .first();

        if (!build) {
          throw new Error("Build not found");
        }

        expect(build.jobStatus).toBe("pending");
        expect(build.name).toBe("current");
        expect(build.repositoryId).toBe(repository.id);
        expect(build.externalId).toBe(null);
        expect(build.batchCount).toBe(null);
        expect(
          build.compareScreenshotBucket!.screenshots!.map((s) => ({
            s3Id: s.s3Id,
            name: s.name,
          }))
        ).toEqual(
          screenshots.map((screenshot) => ({
            s3Id: screenshot.key,
            name: screenshot.name,
          }))
        );
        expect(build.compareScreenshotBucket!.complete).toBe(true);
        expect(build.compareScreenshotBucket!.name).toBe("current");
        expect(build.compareScreenshotBucket!.commit).toBe(
          "b6bf264029c03888b7fb7e6db7386f3b245b77b0"
        );
        expect(build.compareScreenshotBucket!.branch).toBe("main");
        expect(build.compareScreenshotBucket!.repositoryId).toBe(repository.id);

        expect(updateResult.body).toEqual({
          build: {
            id: build.id,
            url: await build.getUrl(),
          },
        });
      });
    });

    describe("complete workflow — parallel", () => {
      let repository: Repository;

      const screenshotGroups = [
        [
          {
            key: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            name: "first",
            path: join(__dirname, "__fixtures__", "screenshot_test.jpg"),
          },
        ],
        [
          {
            key: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589",
            name: "second",
            path: join(__dirname, "__fixtures__", "screenshot_test_2.jpg"),
          },
        ],
      ];

      beforeEach(async () => {
        const organization = await factory.create<Organization>(
          "Organization",
          {
            login: "argos-ci",
          }
        );
        repository = await factory.create<Repository>("Repository", {
          name: "argos",
          organizationId: organization.id,
          token: "awesome-token",
        });
      });

      it("create a complete build", async () => {
        const updateResults = await Promise.all(
          screenshotGroups.map(async (screenshots) => {
            const createResult = await request(app)
              .post("/v2/builds")
              .set("Host", "api.argos-ci.dev")
              .set("Authorization", "Bearer awesome-token")
              .send({
                commit: "b6bf264029c03888b7fb7e6db7386f3b245b77b0",
                screenshotKeys: screenshots.map((screenshot) => screenshot.key),
                branch: "main",
                name: "current",
                parallel: true,
                parallelNonce: "unique-build-id",
              })
              .expect(201);

            // Upload screenshots
            await Promise.all(
              createResult.body.screenshots.map(
                async (resScreenshot: { key: string; putUrl: string }) => {
                  const path = screenshots.find(
                    (s) => s.key === resScreenshot.key
                  )!.path;
                  const file = await readFile(path);

                  const axiosResponse = await axios({
                    method: "PUT",
                    url: resScreenshot.putUrl,
                    data: file,
                    headers: {
                      "Content-Type": "image/jpeg",
                    },
                  });

                  expect(axiosResponse.status).toBe(200);
                }
              )
            );

            const updateResult = await request(app)
              .put(`/v2/builds/${createResult.body.build.id}`)
              .set("Host", "api.argos-ci.dev")
              .set("Authorization", "Bearer awesome-token")
              .send({
                screenshots: screenshots.map((screenshot) => ({
                  key: screenshot.key,
                  name: screenshot.name,
                })),
                parallel: true,
                parallelTotal: 2,
              })
              .expect(200);

            return updateResult;
          })
        );

        const updateBodies = updateResults.map(
          (updateResult) => updateResult.body
        );

        const build = await Build.query()
          .withGraphFetched("compareScreenshotBucket.screenshots.file")
          .first();

        if (!build) {
          throw new Error("Build not found");
        }

        expect(build.jobStatus).toBe("pending");
        expect(build.name).toBe("current");
        expect(build.repositoryId).toBe(repository.id);
        expect(build.externalId).toBe("unique-build-id");
        expect(build.batchCount).toBe(2);
        expect(build.totalBatch).toBe(2);

        expect(
          build.compareScreenshotBucket!.screenshots!.map((s) => ({
            s3Id: s.s3Id,
            name: s.name,
          }))
        ).toEqual(
          expect.arrayContaining(
            screenshotGroups.flat().map((screenshot) => ({
              s3Id: screenshot.key,
              name: screenshot.name,
            }))
          )
        );
        expect(build.compareScreenshotBucket!.complete).toBe(true);
        expect(build.compareScreenshotBucket!.name).toBe("current");
        expect(build.compareScreenshotBucket!.commit).toBe(
          "b6bf264029c03888b7fb7e6db7386f3b245b77b0"
        );
        expect(build.compareScreenshotBucket!.branch).toBe("main");
        expect(build.compareScreenshotBucket!.repositoryId).toBe(repository.id);

        const buildUrl = await build.getUrl();

        updateBodies.forEach((body) => {
          expect(body).toEqual({
            build: {
              id: build.id,
              url: buildUrl,
            },
          });
        });
      }, 10000);

      it("inconsistent parallel count return an error", async () => {
        const updateResults = await Promise.all(
          screenshotGroups.map(async (screenshots, groupIndex) => {
            const createResult = await request(app)
              .post("/v2/builds")
              .set("Host", "api.argos-ci.dev")
              .set("Authorization", "Bearer awesome-token")
              .send({
                commit: "b6bf264029c03888b7fb7e6db7386f3b245b77b0",
                screenshotKeys: screenshots.map((screenshot) => screenshot.key),
                branch: "main",
                name: "current",
                parallel: true,
                parallelNonce: "other-build-id",
              })
              .expect(201);

            // Upload screenshots
            await Promise.all(
              createResult.body.screenshots.map(
                async (resScreenshot: { key: string; putUrl: string }) => {
                  const path = screenshots.find(
                    (s) => s.key === resScreenshot.key
                  )!.path;
                  const file = await readFile(path);

                  const axiosResponse = await axios({
                    method: "PUT",
                    url: resScreenshot.putUrl,
                    data: file,
                    headers: {
                      "Content-Type": "image/jpeg",
                    },
                  });

                  expect(axiosResponse.status).toBe(200);
                }
              )
            );

            const updateResult = await request(app)
              .put(`/v2/builds/${createResult.body.build.id}`)
              .set("Host", "api.argos-ci.dev")
              .set("Authorization", "Bearer awesome-token")
              .send({
                screenshots: screenshots.map((screenshot) => ({
                  key: screenshot.key,
                  name: screenshot.name,
                })),
                parallel: true,
                parallelTotal: 2 + groupIndex,
              });

            return updateResult;
          })
        );

        expect(updateResults[0]!.statusCode).toBe(200);
        expect(updateResults[1]!.statusCode).toBe(400);
        // @ts-ignore
        expect(JSON.parse(updateResults[1]!.error.text).error.message).toBe(
          "`parallelTotal` must be the same on every batch"
        );
      });
    });
  });
});

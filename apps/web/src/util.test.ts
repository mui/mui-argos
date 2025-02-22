import { jest } from "@jest/globals";
import type { Request, Response } from "express";

import { asyncHandler } from "./util.js";

describe("util", () => {
  describe("#asyncHandler", () => {
    it("should fall back to the code", () => {
      const status = 401;
      const next = jest.fn();

      asyncHandler(() => {
        const githubError = new Error("");
        // @ts-ignore
        githubError.code = status;
        // @ts-ignore
        githubError.status = "Unauthorized";
        throw githubError;
      })(null as unknown as Request, null as unknown as Response, next);

      // @ts-ignore
      expect(next.mock.calls[0][0].status).toBe(status);
    });
  });
});

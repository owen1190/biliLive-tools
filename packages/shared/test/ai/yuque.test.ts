import { describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    isAxiosError: vi.fn((error: any) => !!error?.isAxiosError),
  },
}));

import {
  buildYuqueDocumentUrl,
  extractYuqueDocSlug,
  extractYuqueNamespace,
  formatYuqueError,
} from "../../src/ai/yuque.js";

describe("yuque helpers", () => {
  it("extracts namespace from yuque repo url", () => {
    expect(extractYuqueNamespace("https://www.yuque.com/foo/bar")).toBe("foo/bar");
    expect(extractYuqueNamespace("https://www.yuque.com/api/v2/repos/foo/bar/docs/doc-slug")).toBe(
      "foo/bar",
    );
    expect(extractYuqueNamespace("foo/bar")).toBe("foo/bar");
  });

  it("extracts document slug from yuque doc url", () => {
    expect(extractYuqueDocSlug("https://www.yuque.com/foo/bar/doc-slug?view=doc_embed")).toBe(
      "doc-slug",
    );
    expect(extractYuqueDocSlug("https://www.yuque.com/api/v2/repos/foo/bar/docs/doc-slug")).toBe(
      "doc-slug",
    );
    expect(extractYuqueDocSlug("doc-slug")).toBe("doc-slug");
  });

  it("builds document url from namespace and slug", () => {
    expect(buildYuqueDocumentUrl("foo/bar", "doc-slug")).toBe(
      "https://www.yuque.com/foo/bar/doc-slug",
    );
  });

  it("formats yuque 404 into actionable message", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 404,
      },
    };

    expect(formatYuqueError(error)).toBe(
      "语雀知识库或文档不存在，请检查知识库路径 namespace 和文档 slug",
    );
  });
});

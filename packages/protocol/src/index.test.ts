import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  ProtocolError,
  createRequestId,
  isProtocolCompatible,
} from "./index.js";

describe("@securelink/protocol", () => {
  it("exports protocol version", () => {
    expect(PROTOCOL_VERSION).toBe("1.0");
  });

  it("checks major-version compatibility", () => {
    expect(isProtocolCompatible("1.0", "1.2")).toBe(true);
    expect(isProtocolCompatible("2.0", "1.0")).toBe(false);
    expect(isProtocolCompatible("bad", "1.0")).toBe(false);
  });

  it("creates request ids", () => {
    const id = createRequestId();
    expect(id.startsWith("sl_")).toBe(true);
  });

  it("builds protocol errors", () => {
    const err = new ProtocolError("UNAUTHORIZED", "nope", 401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
  });
});

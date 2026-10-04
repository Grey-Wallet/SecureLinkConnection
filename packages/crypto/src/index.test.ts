import { describe, expect, it } from "vitest";
import {
  createChallenge,
  createSignedRequestProof,
  generateKeyPair,
  hashToken,
  sha256,
  sign,
  verify,
  verifySignedRequestProof,
} from "./index.js";

describe("@securelink/crypto", () => {
  it("generates and verifies Ed25519 signatures with public key only", () => {
    const kp = generateKeyPair();
    const sig = sign(kp.privateKey, "hello");
    expect(verify(kp.publicKey, "hello", sig)).toBe(true);
    expect(verify(kp.publicKey, "hello", "00".repeat(32))).toBe(false);
  });

  it("creates challenges", () => {
    expect(createChallenge(8)).toHaveLength(16);
  });

  it("builds request proofs verifiable without private key", () => {
    const kp = generateKeyPair();
    const signed = createSignedRequestProof({
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      requestId: "r1",
      timestamp: 1,
      method: "POST",
      path: "/api",
      body: { a: 1 },
    });
    expect(
      verifySignedRequestProof({
        publicKey: kp.publicKey,
        payload: signed.payload,
        signature: signed.signature,
      }),
    ).toBe(true);
    expect(sha256("x")).toHaveLength(64);
    expect(hashToken("atk_x", "secret")).toHaveLength(64);
  });
});

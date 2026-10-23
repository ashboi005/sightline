import { expect, test } from "bun:test";
import { publicWebSocketUrl, signServicePort, signTunnelArgs } from "./sign-tunnel";

test("a started HTTPS tunnel gives the secure sign-service WebSocket path", () => {
  expect(publicWebSocketUrl('{"msg":"started tunnel","url":"https://demo.ngrok-free.app/"}'))
    .toBe("wss://demo.ngrok-free.app/ws");
});

test("unrelated, insecure, credential-bearing and invalid logs never become endpoints", () => {
  for (const line of [
    '{"msg":"starting web service","url":"http://127.0.0.1:4040"}',
    '{"msg":"started tunnel","url":"http://demo.ngrok-free.app"}',
    '{"msg":"started tunnel","url":"https://secret:token@example.com"}',
    '{"msg":"configuration","url":"https://dashboard.ngrok.com"}',
    "not JSON",
  ]) expect(publicWebSocketUrl(line)).toBeNull();
});

test("tunnel port follows the server fallback and explicit sign-service override", () => {
  expect(signServicePort({ PORT: "7789" })).toBe(7789);
  expect(signServicePort({ PORT: "7789", SIGN_SERVICE_PORT: "7790" })).toBe(7790);
});

test("invalid upstream ports never start a tunnel", () => {
  for (const value of ["0", "65536", "7.5", "not-a-number"]) {
    expect(() => signServicePort({ SIGN_SERVICE_PORT: value })).toThrow();
  }
});


test("every tunnel explicitly requests the configured static domain", () => {
  expect(signTunnelArgs({ NGROK_DOMAIN: "my-static.ngrok-free.app" }))
    .toContain("--url=https://my-static.ngrok-free.app");
  expect(signTunnelArgs({ NGROK_DOMAIN: "https://my-static.ngrok-free.app/", SIGN_SERVICE_PORT: "7790" }))
    .toEqual([
      "http", "http://127.0.0.1:7790", "--url=https://my-static.ngrok-free.app",
      "--inspect=false", "--log=stdout", "--log-format=json",
    ]);
});

test("missing static domain cannot silently create a temporary URL", () => {
  for (const domain of [undefined, "", "   "]) {
    expect(() => signTunnelArgs({ NGROK_DOMAIN: domain })).toThrow("NGROK_DOMAIN");
  }
});

test("invalid static domains are rejected before launching ngrok", () => {
  for (const domain of [
    "http://my-static.ngrok-free.app", "wss://my-static.ngrok-free.app/ws",
    "https://user:secret@example.com", "https://example.com/ws",
    "https://example.com?token=secret", "https://example.com#fragment",
    "example.com:444", "not a domain", "--url=example.com",
  ]) expect(() => signTunnelArgs({ NGROK_DOMAIN: domain })).toThrow("NGROK_DOMAIN");
});

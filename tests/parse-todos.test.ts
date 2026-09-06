import test from "node:test";
import assert from "node:assert/strict";
import { parseTodos, reconstructTodosFromBranch } from "../parse-todos.ts";

// pi-todo stores the todo list in the tool RESULT details, not the input:
//   { action, todos: [{ id, text, done }], nextId, error? }
// Items use `text` + `done` (boolean), not `content` + `status` (string).

test("parses pi-todo result details ({text, done}) with numeric id", () => {
  const details = {
    action: "add",
    todos: [
      { id: 1, text: "Audit this code", done: false },
      { id: 2, text: "Ship it", done: true },
    ],
    nextId: 3,
  };
  const parsed = parseTodos(details);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed!.length, 2);
  assert.equal(parsed![0].id, "1");
  assert.equal(parsed![0].content, "Audit this code");
  assert.equal(parsed![0].status, "pending");
  assert.equal(parsed![1].id, "2");
  assert.equal(parsed![1].content, "Ship it");
  assert.equal(parsed![1].status, "completed");
});

test("action-only tool input (no list) returns null", () => {
  assert.equal(parseTodos({ action: "add", text: "x", id: 1 }), null);
  assert.equal(parseTodos({ action: "list" }), null);
  assert.equal(parseTodos(undefined), null);
  assert.equal(parseTodos("not an object"), null);
});

test("clear action (empty todos array) returns [] not null", () => {
  assert.deepEqual(parseTodos({ action: "clear", todos: [], nextId: 1 }), []);
});

test("bare array input still supported", () => {
  const parsed = parseTodos([{ id: "1", content: "a", status: "in_progress" }]);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed![0].status, "in_progress");
});

test("legacy {content, status, subAction} shape preserved", () => {
  const parsed = parseTodos({
    todos: [
      { id: "1", content: "c", status: "active", subAction: "doing" },
      { id: "2", text: "t", status: "done" },
    ],
  });
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed![0].status, "in_progress");
  assert.equal(parsed![0].subAction, "doing");
  assert.equal(parsed![1].content, "t");
  assert.equal(parsed![1].status, "completed");
});

// Resume reconstruction: each todo tool RESULT carries a full snapshot in
// `details.todos`, so the LAST todo result in the branch is the current state.
// Mirrors how the pi-todo plugin restores state on session_start.

test("reconstructTodosFromBranch: takes last todo result snapshot", () => {
  const branch = [
    { type: "message", message: { role: "user", content: "hi" } },
    {
      type: "message",
      message: { role: "toolResult", toolName: "todo", details: { action: "add", todos: [{ id: 1, text: "a", done: false }], nextId: 2 } },
    },
    {
      type: "message",
      message: { role: "toolResult", toolName: "todo", details: { action: "add", todos: [{ id: 1, text: "a", done: true }, { id: 2, text: "b", done: false }], nextId: 3 } },
    },
  ];
  const todos = reconstructTodosFromBranch(branch);
  assert.equal(todos.length, 2);
  assert.equal(todos[0].status, "completed");
  assert.equal(todos[1].content, "b");
});

test("reconstructTodosFromBranch: empty when no todo results / no branch", () => {
  assert.deepEqual(reconstructTodosFromBranch([{ type: "message", message: { role: "user" } }]), []);
  assert.deepEqual(reconstructTodosFromBranch([]), []);
  assert.deepEqual(reconstructTodosFromBranch(null), []);
  assert.deepEqual(reconstructTodosFromBranch(undefined), []);
});

test("reconstructTodosFromBranch: clear action yields empty", () => {
  const branch = [
    { type: "message", message: { role: "toolResult", toolName: "todo", details: { action: "add", todos: [{ id: 1, text: "a", done: false }], nextId: 2 } } },
    { type: "message", message: { role: "toolResult", toolName: "todo", details: { action: "clear", todos: [], nextId: 1 } } },
  ];
  assert.deepEqual(reconstructTodosFromBranch(branch), []);
});

test("reconstructTodosFromBranch: ignores non-todo tool results", () => {
  const branch = [
    { type: "message", message: { role: "toolResult", toolName: "bash", details: { todos: [{ id: 1, text: "not todo", done: false }] } } },
  ];
  assert.deepEqual(reconstructTodosFromBranch(branch), []);
});

import { describe, expect, it } from "vitest";
import { invokeTodoStoreMutation } from "../src/projectsTodo/storeDispatch";

describe("Projects TODO store mutation dispatch", () => {
    it("preserves the TodoStore receiver for delete mutations", async () => {
        class Receiver {
            readonly repository = {};
            called = false;

            async deleteTodo(): Promise<void> {
                this.called = true;
                expect(this.repository).toBeDefined();
            }
        }

        const receiver = new Receiver();

        await invokeTodoStoreMutation(
            receiver,
            "deleteTodo",
            {
                line: 3,
                text: "remove this",
                checked: false,
                kind: "checkbox",
                projectPath: "/tmp/project",
            },
        );

        expect(receiver.called).toBe(true);
    });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ChatForm } from "./ChatForm";

/**
 * The field is exercised through `ChatForm` rather than in isolation: what
 * Enter means lives in the form's handler, and mounting the pair is what proves
 * the two halves agree.
 */
function renderField() {
  const onSubmit = vi.fn();
  render(<ChatForm onSubmit={onSubmit} />);
  return { onSubmit };
}

function field() {
  return screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
}

describe("ChatInput", () => {
  it("renders a textarea with an accessible name, not a single-line input", () => {
    renderField();

    // getByRole(…, { name }) resolving at all is the accessible name: the
    // placeholder is dropped as soon as there is a value, so it is not one.
    expect(field().tagName).toBe("TEXTAREA");
    expect(field()).toHaveAttribute("rows", "1");
  });

  it("holds a newline in its value, which an <input> would strip", () => {
    renderField();

    fireEvent.change(field(), { target: { value: "line one\nline two" } });

    expect(field().value).toBe("line one\nline two");
  });

  it("submits on a bare Enter and prevents the default", async () => {
    const { onSubmit } = renderField();
    fireEvent.change(field(), { target: { value: "ship it" } });

    // fireEvent returns false when the handler called preventDefault.
    const notPrevented = fireEvent.keyDown(field(), { key: "Enter" });

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("ship it"));
  });

  it("does not submit on Shift+Enter, and leaves the newline to the browser", async () => {
    const { onSubmit } = renderField();
    fireEvent.change(field(), { target: { value: "line one" } });

    const notPrevented = fireEvent.keyDown(field(), {
      key: "Enter",
      shiftKey: true,
    });

    // Leaving the event un-prevented is the whole of what this component
    // controls: the insertion itself is the browser's, and jsdom does not carry
    // out a keypress's own text insertion. Proving the newline arrives would
    // need @testing-library/user-event, which is not a dependency here — the
    // field's ability to hold one is covered separately above.
    expect(notPrevented).toBe(true);
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("does neither while an IME composition is active", async () => {
    const { onSubmit } = renderField();
    fireEvent.change(field(), { target: { value: "にほん" } });

    const notPrevented = fireEvent.keyDown(field(), {
      key: "Enter",
      isComposing: true,
    });

    expect(notPrevented).toBe(true);
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it("mirrors the value into the sizer that drives the field's growth", () => {
    renderField();
    fireEvent.change(field(), { target: { value: "line one\nline two" } });

    // The sizer is the element the grid row is sized from, so it has to hold
    // the same text including its newlines, plus the trailing space that keeps
    // a row open for a caret sitting after a final newline. Whether that text
    // then produces the right height is layout, which jsdom does not do.
    // Selected as the textarea's own sibling rather than by aria-hidden, which
    // the submit button's icon also carries.
    expect(field().previousElementSibling?.textContent).toBe(
      "line one\nline two ",
    );
  });

  it("wraps the field in a label, so its padding is not a dead click band", () => {
    renderField();
    const wrapper = field().parentElement as HTMLElement;

    // The box chrome sits on the wrapper, which puts its padding outside the
    // textarea's own hit area. A <label> is what gives that band back: clicking
    // it focuses the control natively, as the padded <input> this replaces did.
    expect(wrapper.tagName).toBe("LABEL");
    expect((wrapper as HTMLLabelElement).control).toBe(field());
  });
});

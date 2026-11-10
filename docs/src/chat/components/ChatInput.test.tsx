import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MAX_MESSAGE_LENGTH } from "../lib/chat-constants";
import { ChatInput } from "./ChatInput";

/**
 * The field on its own: it reports its value and owns its size, its cap and
 * its count. What Enter means, and what a refused or blank message does, belong
 * to the composer (`DoxChat`), and are tested there.
 */
function Field() {
  const [value, setValue] = useState("");
  return (
    <ChatInput
      value={value}
      onChange={setValue}
      label="Message"
      placeholder="Type a message..."
      // A caller's rounding, which the field's wrapper is to clip a scrollbar to.
      className="rounded-lg"
      maxLength={MAX_MESSAGE_LENGTH}
    />
  );
}

function renderField() {
  render(<Field />);
}

function field() {
  return screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
}

/** The remaining-characters count, which is mounted whether or not it is due. */
function count() {
  return screen.getByRole("status");
}

/** A value that leaves exactly `remaining` characters before the cap. */
function valueLeaving(remaining: number) {
  return "x".repeat(MAX_MESSAGE_LENGTH - remaining);
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

  it("caps the field at the same length the Worker enforces", () => {
    renderField();

    // The DOM property rather than the attribute: it is typed as a number, so
    // this reads against the constant without stringifying it. maxLength is
    // what stops the value ever reaching the length worker.ts rejects.
    expect(field().maxLength).toBe(MAX_MESSAGE_LENGTH);
  });

  it("says nothing about length until the last tenth of the cap", () => {
    renderField();
    fireEvent.change(field(), {
      target: { value: valueLeaving(MAX_MESSAGE_LENGTH / 10 + 1) },
    });

    // Empty rather than unmounted, and that is the point: a live region has to
    // predate its first content to be announced at all. Nothing is on screen
    // either way, which is what this asserts.
    expect(count().textContent).toBe("");
  });

  it("counts down the last tenth, so the cap is visible before it truncates", () => {
    renderField();
    fireEvent.change(field(), {
      target: { value: valueLeaving(MAX_MESSAGE_LENGTH / 10) },
    });

    expect(count().textContent).toBe("2,000 characters left");
  });

  it("drops to the singular on the last character", () => {
    renderField();
    fireEvent.change(field(), { target: { value: valueLeaving(1) } });

    expect(count().textContent).toBe("1 character left");
  });

  it("describes the field with that count, for a reader who cannot see it", () => {
    renderField();

    expect(field().getAttribute("aria-describedby")).toBe(count().id);
  });

  it("pads the textarea itself, so its scrollbar reaches the field's edge", () => {
    renderField();
    const wrapper = field().parentElement as HTMLElement;

    // Where the padding lives is the behaviour, not a style preference: a
    // scrollbar is laid out inside its own element's border box, so padding on
    // the wrapper held the textarea's scrollbar 16px in from the field's right
    // edge and 8px off its top and bottom, floating in the middle of the box.
    // jsdom does no layout, so the class is what can be pinned here; the
    // measurement lives in the commit that moved it.
    expect(field().className).toContain("px-4 py-2");
    expect(wrapper.className).not.toContain("px-4");
    expect(wrapper.className).not.toContain("py-2");

    // The sizer has to carry the identical padding, since it is what the grid
    // row is sized from — anything less and the cell is short by that much.
    expect(field().previousElementSibling?.className).toContain("px-4 py-2");
  });

  it("clips the scrollbar to the field's rounded corners", () => {
    renderField();
    const wrapper = field().parentElement as HTMLElement;

    // The textarea's box reaches the wrapper's border now, so its scrollbar is
    // drawn at the corner. Chrome does not apply an element's own radius to a
    // native scrollbar, so the clip has to come from the rounded ancestor —
    // rounding the textarea instead is inert, and looks like it works only if
    // it is checked against a `::-webkit-` styled scrollbar, which is a custom
    // one and is clipped. The pair below is what actually does it.
    expect(wrapper.className).toContain("rounded-lg");
    expect(wrapper.className).toContain("overflow-hidden");
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

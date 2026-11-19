import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, mock, test } from "bun:test";
import { ConfirmDialog } from "./confirm-dialog";

function openDialog(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      trigger={<button type="button">Remove record</button>}
      title="Confirm removal"
      description="This records the removal."
      confirmLabel="Remove"
      onConfirm={onConfirm}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove record" }));
}

describe("ConfirmDialog", () => {
  test("shows the title and description when opened", () => {
    openDialog(() => {});

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm removal")).toBeInTheDocument();
    expect(screen.getByText("This records the removal.")).toBeInTheDocument();
  });

  test("Cancel closes the dialog without confirming", () => {
    const onConfirm = mock(() => {});
    openDialog(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Confirm awaits onConfirm and closes the dialog", async () => {
    const onConfirm = mock(() => Promise.resolve());
    openDialog(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("shows a pending label while onConfirm is in flight", async () => {
    let finish!: () => void;
    const onConfirm = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    openDialog(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    finish();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});

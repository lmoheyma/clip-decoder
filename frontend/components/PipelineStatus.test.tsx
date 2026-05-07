import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PipelineStatus } from "./PipelineStatus";

describe("PipelineStatus", () => {
  it("highlights only completed steps", () => {
    render(
      <PipelineStatus
        events={[
          { step: "ingest", message: "Downloaded", progress: 0.1, payload: {} },
          { step: "shots", message: "12 shots", progress: 0.2, payload: {} },
        ]}
      />,
    );
    expect(screen.getByText("INGEST")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("SHOTS")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("VISION")).toHaveAttribute("data-active", "false");
  });

  it("renders the latest message", () => {
    render(
      <PipelineStatus
        events={[
          { step: "ingest", message: "Downloaded 'X'", progress: 0.1, payload: {} },
          { step: "vision", message: "Analyzed 5 frames", progress: 0.5, payload: {} },
        ]}
      />,
    );
    expect(screen.getByText("Analyzed 5 frames")).toBeInTheDocument();
  });
});

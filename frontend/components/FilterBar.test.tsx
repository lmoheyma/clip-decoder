import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterBar } from "./FilterBar";
import type { Confidence } from "@/lib/types";

const verdictCounts: Record<Confidence, number> = {
  confirmed: 12,
  speculative: 5,
  hidden: 2,
};
const typeCounts = { Film: 8, Painting: 4 };

describe("FilterBar", () => {
  it("toggle verdict chip calls onToggleVerdict", () => {
    const onToggleVerdict = vi.fn();
    const onToggleType = vi.fn();
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film", "Painting"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film", "Painting"])}
        onToggleVerdict={onToggleVerdict}
        onToggleType={onToggleType}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hidden/i }));
    expect(onToggleVerdict).toHaveBeenCalledWith("hidden");
    expect(onToggleType).not.toHaveBeenCalled();
  });

  it("default selection marks hidden chip as inactive via aria-pressed", () => {
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film"])}
        onToggleVerdict={() => {}}
        onToggleType={() => {}}
      />,
    );
    const hiddenChip = screen.getByRole("button", { name: /hidden/i });
    expect(hiddenChip).toHaveAttribute("aria-pressed", "false");
    const confirmedChip = screen.getByRole("button", { name: /confirmed/i });
    expect(confirmedChip).toHaveAttribute("aria-pressed", "true");
  });

  it("toggle work_type chip is independent from verdict chips", () => {
    const onToggleVerdict = vi.fn();
    const onToggleType = vi.fn();
    render(
      <FilterBar
        verdictCounts={verdictCounts}
        typeCounts={typeCounts}
        availableTypes={["Film", "Painting"]}
        selectedVerdicts={new Set<Confidence>(["confirmed", "speculative"])}
        selectedTypes={new Set(["Film", "Painting"])}
        onToggleVerdict={onToggleVerdict}
        onToggleType={onToggleType}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /painting/i }));
    expect(onToggleType).toHaveBeenCalledWith("Painting");
    expect(onToggleVerdict).not.toHaveBeenCalled();
  });
});

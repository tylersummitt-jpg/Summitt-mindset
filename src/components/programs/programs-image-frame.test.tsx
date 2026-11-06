/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramsGallery } from "@/components/programs/programs-structured";
import { ProgramsQuoteImage } from "@/components/programs/programs-quote-image";
import { getLearningMiniProgram } from "@/lib/learning/load-curriculum";
import type { LearningGalleryImage, LearningImageBlock } from "@/lib/learning/curriculum-types";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
    style,
    width,
    height,
  }: {
    src?: string;
    alt?: string;
    className?: string;
    style?: CSSProperties;
    width?: number;
    height?: number;
  }) => (
    // Test double for next/image. The real SVG path is a separate plain img.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ""}
      className={className}
      data-next-image="true"
      height={height}
      src={src ?? ""}
      style={style}
      width={width}
    />
  ),
}));

afterEach(() => {
  cleanup();
});

function imageBlock(programId: string, stepId: string, file: string): LearningImageBlock {
  const block = getLearningMiniProgram(programId)
    ?.steps.find((step) => step.id === stepId)
    ?.blocks.find((candidate) => candidate.type === "image" && candidate.src.endsWith(file));
  if (!block || block.type !== "image") throw new Error(file);
  return block;
}

function gallery(programId: string, stepId: string, labelIncludes: string) {
  const block = getLearningMiniProgram(programId)
    ?.steps.find((step) => step.id === stepId)
    ?.blocks.find((candidate) => candidate.type === "gallery" && candidate.label.includes(labelIncludes));
  if (!block || block.type !== "gallery") throw new Error(stepId);
  return block;
}

function renderImage(block: LearningImageBlock, quote?: string) {
  return render(
    <ProgramsQuoteImage
      src={block.src}
      alt={block.alt}
      width={block.width}
      height={block.height}
      quote={quote ?? block.quote}
      attribution={block.attribution}
    />
  );
}

describe("standalone lesson images", () => {
  it("caps and centers a portrait without a fixed slot or crop", () => {
    renderImage(imageBlock("dd_mp_05", "dd_mp_05_st_011", "dd_mp_05_st_011_image_02.jpg"));
    const figure = document.querySelector("[data-image-frame='portrait']");
    const image = screen.getByRole("img");
    expect(figure?.querySelector(".mx-auto.w-fit")).toBeTruthy();
    expect(image.className).toContain("object-contain");
    expect(image.className).not.toContain("object-cover");
    expect(image.className).not.toContain("h-48");
    expect(image.className).not.toContain("h-56");
    expect(image.getAttribute("style")).toContain("max-width: min(22rem, 326px)");
    expect(image.getAttribute("style")).toContain("max-height: 32rem");
    expect(image.getAttribute("style")).not.toContain("aspect-ratio");
  });

  it("caps a square and centers it", () => {
    renderImage(imageBlock("potl_mp_01", "potl_mp_01_st_002", "potl_mp_01_st_002_image_02.png"));
    const image = screen.getByRole("img", {
      name: "Good teams are built on skills, great teams are built on trust.",
    });
    expect(document.querySelector("[data-image-frame='square']")).toBeTruthy();
    expect(image.getAttribute("style")).toContain("max-width: 28rem");
    expect(image.className).toContain("mx-auto");
    expect(image.className).not.toContain("object-cover");
    expect(image.className).not.toContain("h-48");
    expect(image.className).not.toContain("h-56");
  });

  it("gives a 3:2 landscape and a banner the lesson width at their own height", () => {
    const { unmount } = renderImage(imageBlock("dd_mp_06", "dd_mp_06_st_008", "dd_mp_06_st_008_image_02.jpg"));
    let image = screen.getByRole("img");
    expect(document.querySelector("[data-image-frame='landscape']")).toBeTruthy();
    expect(image.getAttribute("style")).toContain("width: 100%");
    expect(image.getAttribute("style")).toContain("height: auto");
    expect(image.getAttribute("style")).not.toContain("max-height");
    expect(image.className).not.toContain("h-48");
    expect(image.className).not.toContain("object-cover");
    unmount();

    renderImage(imageBlock("dd_mp_02", "dd_mp_02_st_018", "dd_mp_02_st_018_wrap_up.jpg"));
    image = screen.getByRole("img");
    expect(image.getAttribute("style")).toContain("width: 100%");
    expect(image.getAttribute("style")).toContain("height: auto");
    expect(Number(image.getAttribute("width")) / Number(image.getAttribute("height"))).toBeGreaterThan(2);
  });

  it("keeps a quote portrait uncropped, with the quote in text", () => {
    renderImage(
      imageBlock("dd_mp_02", "dd_mp_02_st_011", "dd_mp_02_st_011_quote_1.jpg"),
      "Truth 1: \"We go is more important than ego.\""
    );
    const image = screen.getByRole("img");
    expect(document.querySelector("[data-image-frame='portrait']")).toBeTruthy();
    expect(image.className).not.toContain("object-cover");
    expect(image.getAttribute("style")).not.toContain("aspect-ratio");
    expect(screen.getByText(/We go is more important than ego/)).toBeTruthy();
    expect(image.getAttribute("data-next-image")).toBe("true");
  });

  it("renders the communication diagram as a plain image with its file labels intact", () => {
    renderImage(imageBlock("dd_mp_05", "dd_mp_05_st_011", "dd_mp_05_st_011_image_03.svg"));
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toContain("dd_mp_05_st_011_image_03.svg");
    expect(image.getAttribute("data-next-image")).toBeNull();
    expect(image.getAttribute("width")).toBe("900");
    expect(image.getAttribute("height")).toBe("520");
    expect(image.className).toContain("object-contain");
  });
});

describe("lesson galleries", () => {
  it("uses contained cells, a two-column pair, and a four-column portrait set", () => {
    const pair = gallery("potl_mp_08", "potl_mp_08_st_003", "Extroverts");
    const { unmount } = render(<ProgramsGallery label={pair.label} images={pair.images} />);
    let list = screen.getByRole("list");
    expect(list.className).toContain("grid-cols-1");
    expect(list.className).toContain("sm:grid-cols-2");
    expect(list.className).not.toContain("aspect-");
    expect(screen.getAllByRole("img")).toHaveLength(2);
    for (const image of screen.getAllByRole("img")) {
      expect(image.className).toContain("object-contain");
      expect(image.className).not.toContain("object-cover");
      expect(image.className).not.toContain("h-48");
    }
    unmount();

    const portraits = {
      label: "Relationship scenario characters",
      images: Array.from({ length: 12 }, (_, index) => ({
        src: `/learning/definite-dozen/portrait-${index + 1}.png`,
        alt: `Portrait ${index + 1}`,
        width: 800,
        height: 1600,
      })),
    };
    render(<ProgramsGallery label={portraits.label} images={portraits.images} />);
    list = screen.getByRole("list");
    expect(list.getAttribute("data-gallery-layout")).toBe("portraits");
    expect(list.className).toContain("grid-cols-2");
    expect(list.className).toContain("sm:grid-cols-4");
    const rendered = screen.getAllByRole("img");
    expect(rendered.map((image) => image.getAttribute("src"))).toEqual(
      portraits.images.map((image: LearningGalleryImage) => image.src)
    );
  });

  it("keeps the 16 history photos in one gallery without a crop frame", () => {
    const history = gallery("cw_mp_01", "cw_mp_01_st_002", "farm");
    render(<ProgramsGallery label={history.label} images={history.images} />);
    const list = screen.getByRole("list");
    expect(list.getAttribute("data-gallery-layout")).toBe("landscapes");
    expect(list.className).toContain("grid-cols-1");
    expect(list.className).toContain("sm:grid-cols-2");
    const rendered = screen.getAllByRole("img");
    expect(rendered).toHaveLength(16);
    expect(rendered.map((image) => image.getAttribute("src"))).toEqual(
      history.images.map((image) => image.src)
    );
    expect(list.innerHTML).not.toContain("aspect-[4/3]");
    expect(list.innerHTML).not.toContain("object-cover");
  });
});

/* eslint-disable import/namespace */
import { compare } from "odiff-bin";

import { tmpName } from "@argos-ci/storage";
import type { ImageFile } from "@argos-ci/storage";

const createDifference = async (options: {
  baseImageFilepath: string;
  compareImageFilepath: string;
  diffImageFilepath: string;
}) => {
  const result = await compare(
    options.baseImageFilepath,
    options.compareImageFilepath,
    options.diffImageFilepath,
    {
      outputDiffMask: true,
    }
  );

  if (result.match) {
    return 0;
  }

  switch (result.reason) {
    case "file-not-exists":
      throw new Error(`File not exists`);
    case "layout-diff":
      return 1;
    case "pixel-diff":
      return result.diffPercentage;
    default:
      throw new Error(`Unknown reason`);
  }
};

async function getMaxDimensions(images: ImageFile[]) {
  const imagesDimensions = await Promise.all(
    images.map(async (image) => image.getDimensions())
  );

  return {
    width: Math.max(...imagesDimensions.map(({ width }) => width)),
    height: Math.max(...imagesDimensions.map(({ height }) => height)),
  };
}

export default async function imageDifference(optionsWithoutDefault: {
  baseImage: ImageFile;
  compareImage: ImageFile;
}) {
  const { baseImage, compareImage } = optionsWithoutDefault;

  const [
    baseImageFilepath,
    compareImageFilepath,
    maxDimensions,
    diffImageFilepath,
  ] = await Promise.all([
    baseImage.getFilepath(),
    compareImage.getFilepath(),
    getMaxDimensions([baseImage, compareImage]),
    tmpName({ postfix: ".png" }),
  ]);

  // Create difference
  const score = await createDifference({
    baseImageFilepath,
    compareImageFilepath,
    diffImageFilepath,
  });

  return {
    ...maxDimensions,
    filepath: diffImageFilepath,
    value: score,
  };
}

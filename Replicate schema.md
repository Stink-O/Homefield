google/nano-banana-2

NB2 Json Input Schema: https://replicate.com/google/nano-banana-2/api/schema
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "A text description of the image you want to generate"
    },
    "resolution": {
      "enum": [
        "1K",
        "2K",
        "4K"
      ],
      "type": "string",
      "title": "resolution",
      "description": "Resolution of the generated image. Higher resolutions take longer to generate.",
      "default": "1K",
      "x-order": 3
    },
    "image_input": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri"
      },
      "title": "Image Input",
      "default": [],
      "x-order": 1,
      "description": "Input images to transform or use as reference (supports up to 14 images)"
    },
    "aspect_ratio": {
      "enum": [
        "match_input_image",
        "1:1",
        "1:4",
        "1:8",
        "2:3",
        "3:2",
        "3:4",
        "4:1",
        "4:3",
        "4:5",
        "5:4",
        "8:1",
        "9:16",
        "16:9",
        "21:9"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Aspect ratio of the generated image",
      "default": "match_input_image",
      "x-order": 2
    },
    "image_search": {
      "type": "boolean",
      "title": "Image Search",
      "default": false,
      "x-order": 5,
      "description": "Use Google Image Search grounding to find web images as visual context for generation. When enabled, web search is also used automatically."
    },
    "google_search": {
      "type": "boolean",
      "title": "Google Search",
      "default": false,
      "x-order": 4,
      "description": "Use Google Web Search grounding to generate images based on real-time information (e.g. weather, sports scores, recent events)."
    },
    "output_format": {
      "enum": [
        "jpg",
        "png"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Format of the output image",
      "default": "jpg",
      "x-order": 6
    }
  }
}
Do not change the current aspect ratio selection we have, it is working well. and some of googles selection of aspect ratios arent functioning as expected.

NB2 Json Output Schema:
{
  "type": "string",
  "title": "Output",
  "format": "uri"
}


google/nano-banana-pro

Json Input Schema: https://replicate.com/google/nano-banana-pro/api/schema:
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "A text description of the image you want to generate"
    },
    "resolution": {
      "enum": [
        "1K",
        "2K",
        "4K"
      ],
      "type": "string",
      "title": "resolution",
      "description": "Resolution of the generated image",
      "default": "2K",
      "x-order": 3
    },
    "image_input": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri"
      },
      "title": "Image Input",
      "default": [],
      "x-order": 1,
      "description": "Input images to transform or use as reference (supports up to 14 images)"
    },
    "aspect_ratio": {
      "enum": [
        "match_input_image",
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Aspect ratio of the generated image",
      "default": "match_input_image",
      "x-order": 2
    },
    "output_format": {
      "enum": [
        "jpg",
        "png"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Format of the output image",
      "default": "jpg",
      "x-order": 4
    },
    "safety_filter_level": {
      "enum": [
        "block_low_and_above",
        "block_medium_and_above",
        "block_only_high"
      ],
      "type": "string",
      "title": "safety_filter_level",
      "description": "block_low_and_above is strictest, block_medium_and_above blocks some prompts, block_only_high is most permissive but some prompts will still be blocked",
      "default": "block_only_high",
      "x-order": 5
    },
    "allow_fallback_model": {
      "type": "boolean",
      "title": "Allow Fallback Model",
      "default": false,
      "x-order": 6,
      "description": "Fallback to another model (currently bytedance/seedream-5) if Nano Banana Pro is at capacity."
    }
  }
}
Do not change the current aspect ratio selection we have, it is working well. and some of googles selection of aspect ratios arent functioning as expected.

Json Output Schema:
{
  "type": "string",
  "title": "Output",
  "format": "uri"
}


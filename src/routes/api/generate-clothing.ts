import { createFileRoute } from "@tanstack/react-router";
import { TEMPLATE_B64 } from "@/lib/api/roblox-template.server";

type ModelChoice = "gemini" | "gpt";
type Flags = {
  nac?: boolean;
  rpb?: boolean;
  rmtpc?: boolean;
  dra?: boolean;
  chroma?: boolean;
  limb?: boolean;
  learn?: boolean;
};
type InpaintRegion =
  | "torso"
  | "right_arm"
  | "left_arm"
  | "right_leg"
  | "left_leg";
type Body = {
  type: "shirt" | "pants";
  prompt: string;
  references?: string[]; // data URLs
  model?: ModelChoice;
  flags?: Flags;
  /** Distilled rules learned from the user's previous feedback. */
  learned?: string[];
  inpaint?: {
    region: InpaintRegion;
    baseImage: string;
    refinement?: string;
  };
};



const TEMPLATE_RULES = `MANDATORY ROBLOX CLASSIC CLOTHING TEMPLATE.
The FIRST attached image is the OFFICIAL Roblox classic clothing template (585x559 px UV layout). You MUST use it as the exact base layout. Replicate its grid, cell positions, dotted boundary lines, and proportions with pixel-level fidelity. Draw the design ONLY inside the empty white cells of the template. DO NOT redraw the avatar, the small labeled isometric cube diagrams on the left, the "Roblox Shirt Template" logo, the helper text, or the TORSO / RIGHT ARM / LEFT ARM labels — those areas must remain visually identical to the template. ONLY the empty cells get filled with the new garment texture aligned to the corresponding body part.`;

const SHIRT_HINT = `EXACT SHIRT CELL MAP (Roblox classic shirt template, 585x559). Identify each panel from the official template image and fill it with the CORRECT face of the garment — never swap panels, never mirror wrong, never blend two body parts into one rectangle:
- TORSO group (upper-middle of the template):
  • Torso FRONT — the chest/belly of the shirt (logos, zippers, buttons, crests go here, upright).
  • Torso BACK — the back of the shirt (mirror of front; back prints, hood drape, etc.).
  • Torso TOP — what is seen looking down at the shoulders/collar (collar ring, hood opening).
  • Torso BOTTOM — the underside hem of the shirt.
  • Torso LEFT SIDE / RIGHT SIDE — thin vertical strips matching the side seams.
- RIGHT ARM group (lower-left of the template, labeled RIGHT ARM):
  • Arm FRONT — facing the camera, sleeve from shoulder to wrist, upright.
  • Arm BACK — opposite face of the sleeve.
  • Arm TOP — the shoulder cap (what is seen from above).
  • Arm BOTTOM — the cuff/hand opening (what is seen from below).
  • Arm LEFT SIDE / RIGHT SIDE — inner and outer sleeve strips.
- LEFT ARM group (lower-right of the template, labeled LEFT ARM): same six faces as right arm, MIRRORED so the assembled sleeve reads symmetrically on the avatar.
Continuity rules: edges that meet on the 3D avatar (e.g. torso-front's top edge meets torso-top's front edge; arm-front's top edge meets arm-top's front edge; arm-bottom edges meet across both arms) MUST share the same color, pattern alignment, and stitching line so the seams disappear when wrapped. Designs that span panels (a stripe going around the torso, a sleeve cuff band) must continue across the correct adjacent cells — do not restart the pattern inside the wrong cell. Keep every print upright relative to the avatar's head, not relative to the cell.`;

const PANTS_HINT = `EXACT PANTS CELL MAP (Roblox classic pants template, 585x559). Identify each panel and fill it with the CORRECT face of the leg:
- CRITICAL — IN THE ROBLOX CLASSIC PANTS TEMPLATE, THE LEGS ARE PAINTED INTO THE TWO LOWER PANEL GROUPS OF THE 585x559 SHEET (the same two big rectangular groups that the shirt template labels "RIGHT ARM" and "LEFT ARM" — lower-left and lower-right of the sheet). Those two groups ARE the legs for pants. The upper "TORSO" panel group of the sheet is UNUSED for pants and MUST be left fully alpha = 0 (transparent), exactly like the official template background. NEVER paint a torso/shirt/belt/waist/chest design into the upper torso group when generating pants — pants have no torso panels.
- RIGHT LEG group (the LOWER-LEFT panel group of the sheet, the one shirts call "RIGHT ARM"): FRONT (front of thigh/shin), BACK (back of leg), TOP (waistband/hip top), BOTTOM (shoe/foot opening), LEFT SIDE (inner thigh), RIGHT SIDE (outer thigh / side stripe).
- LEFT LEG group (the LOWER-RIGHT panel group of the sheet, the one shirts call "LEFT ARM"): same six faces, MIRRORED.
- The labels printed on the template ("RIGHT ARM" / "LEFT ARM") refer to SHIRT MODE only. In PANTS MODE you ignore those words and treat those exact same two panel groups as RIGHT LEG / LEFT LEG. Do NOT add new panels elsewhere on the sheet, do NOT shrink or rescale them, do NOT shift them up into the torso area. Same pixel coordinates, different garment role.
- The upper torso panel group, the small isometric avatar diagrams on the left, the Roblox logo, and the helper text remain visually identical to the template (their pixels untouched). Only the two lower panel groups get filled with the leg textures.
Continuity rules: waistband must align across both legs at the TOP cells; side stripes/seams must continue from waistband down to cuff across the correct side cells; pocket placement on FRONT must mirror correctly on the opposite leg; cuff bands must share the same color and width on both BOTTOM cells. Keep prints upright relative to the avatar.`;

const PANTS_VS_SHIRT_DISCIPLINE = `PANTS vs SHIRT MODE DISCIPLINE (HARD RULE, ZERO TOLERANCE — REPEATED FOR EMPHASIS):
You are generating a ROBLOX CLASSIC ${"${MODE}"} TEMPLATE. The PNG layout (585x559) is identical for shirts and pants, but the role of each panel group changes by mode. Confusing them is the #1 banned failure.

SHIRT MODE (type = "shirt"):
- UPPER panel group of the sheet = TORSO (front/back/top/bottom/sides of the chest). MUST be painted.
- LOWER-LEFT panel group = RIGHT ARM (six faces). MUST be painted.
- LOWER-RIGHT panel group = LEFT ARM (six faces, mirrored). MUST be painted.
- There are NO leg panels in a shirt. Do not invent any.

PANTS MODE (type = "pants"):
- LOWER-LEFT panel group of the sheet = RIGHT LEG (six faces). MUST be painted with the leg texture (thigh/shin/waist/cuff/sides).
- LOWER-RIGHT panel group of the sheet = LEFT LEG (six faces, mirrored). MUST be painted with the leg texture.
- UPPER torso panel group = UNUSED. Leave EVERY pixel of the upper torso group at alpha = 0 (fully transparent). DO NOT paint a shirt, belt, jacket, waistband-on-torso, chest design, hoodie, or ANY garment in the upper torso group when in pants mode. The waistband of the pants lives at the TOP edge of the LEG groups (the panels that shirts call the shoulder caps of the arms), not in the torso group.
- The arm/torso labels printed on the template are SHIRT-MODE labels; in pants mode reinterpret the two lower groups as legs and ignore the printed "ARM" wording.
- A pants output where the upper torso group is painted with any color/garment is REJECTED. A pants output where the legs are painted in the wrong group (e.g. in the upper torso area) is REJECTED.

SELF-CHECK BEFORE OUTPUT FOR PANTS:
[a] Upper torso panel group is FULLY transparent (alpha = 0) — no color, no fabric, no skin, no white.
[b] Lower-left group is a fully painted RIGHT LEG with all six faces correct.
[c] Lower-right group is a fully painted LEFT LEG, mirrored.
[d] Waistband sits at the TOP edge of the leg groups, continuous across both legs.
[e] Cuffs sit at the BOTTOM edge of the leg groups, matched on both legs.
[f] No torso/shirt/sleeve element exists anywhere in the output.

SELF-CHECK BEFORE OUTPUT FOR SHIRT:
[a] Upper torso panel group is fully painted with the shirt body.
[b] Both lower groups are painted as left/right ARMS (not legs).
[c] No waistband-of-pants or leg cuff exists anywhere.

If you mix the modes — painting a shirt when the user asked for pants, or painting legs in the torso group — the output is REJECTED. Repaint internally before emitting.

REPEAT — INTERNALIZE 50x: PANTS = LOWER TWO GROUPS ONLY, UPPER TORSO GROUP STAYS TRANSPARENT. SHIRT = UPPER TORSO + LOWER TWO GROUPS, ALL PAINTED. NEVER CONFUSE THE TWO. NEVER PAINT A SHIRT IN PANTS MODE. NEVER PAINT PANTS IN SHIRT MODE. NEVER PAINT LEGS IN THE UPPER TORSO GROUP. NEVER LEAVE THE TORSO GROUP TRANSPARENT IN SHIRT MODE.`;

const CRITICAL_2D = `CRITICAL — THE OUTPUT IS A FLAT 2D ROBLOX CLOTHING UV TEMPLATE, NOT A 3D RENDER, NOT A PHOTO, NOT AN ILLUSTRATION OF A CHARACTER WEARING THE OUTFIT.
- It is a flat orthographic UV unwrap that Roblox wraps onto a blocky avatar. Think "Minecraft skin layout" or "Roblox classic shirt PNG" — flat, hand-painted/stylized, low-detail enough to read at small size on an avatar.
- Each panel is a FLAT rectangle drawn straight-on, as if the fabric were laid flat on a scanner. NO perspective, NO foreshortening, NO vanishing points, NO camera angle, NO depth-of-field, NO cinematic lighting, NO photorealistic rendering of 3D objects.
- ABSOLUTELY NEVER render: a 3D character, a mannequin, a person, a torso shape, articulated armor pieces, pauldrons curving in space, gauntlets in perspective, chainmail wrapping around a body, a full suit of armor standing in a scene, or any volumetric subject. The only character allowed in the image is the tiny isometric reference avatar already on the left of the template.
- For ANY theme (medieval armor, hoodie, leather jacket, suit, dress, uniform, knight, samurai, etc.): draw the MATERIAL, PATTERN, and DETAILS as a FLAT TEXTURE filling the rectangular cells. Example: "medieval armor" = each rectangular cell filled with a flat metallic plate texture with rivets, edges, crest, and shading PAINTED ONTO the rectangle — NOT a 3D chestplate model. The cells stay rectangular; the design is painted INTO the rectangles.
- If the prompt would normally suggest a 3D object, mentally convert it to a flat tileable game texture before drawing.`;

const COHERENCE = `COHERENCE & SEAM RULES (MANDATORY):
1) Identify every labeled region (TORSO, RIGHT ARM, LEFT ARM, or both LEGS for pants) before painting. Never put torso details in arm cells, never put cuff art on the shoulder cap, never mix front/back.
2) Treat the six faces of each body part as a single 3D box that has been unfolded. Pick a consistent UP direction per cell so that when Roblox folds the texture back, every print reads upright on the avatar.
3) Adjacent edges between cells of the SAME body part must match pixel-for-pixel (same color, same pattern phase, same stitching). No abrupt color jumps at panel borders that belong to the same box.
4) Symmetry: left arm/leg must be a true mirror of the right arm/leg unless the brief explicitly asks for asymmetry. Pockets, stripes, logos must end up on the correct side after the mirror.
5) Keep the unused/background area of the template flat and clean (matching the official template's outer background); do not bleed garment art outside the labeled cells.`;

const TRANSPARENCY = `TRANSPARENCY (REAL PNG ALPHA — ZERO TOLERANCE FOR FAKES):
- THE OUTPUT FILE FORMAT IS PNG-32 WITH A REAL ALPHA CHANNEL. Not JPEG. Not PNG-24. Not a flattened RGB image with white/gray background. The image MUST have per-pixel alpha so Roblox can composite it over the avatar skin.
- "Transparent" means alpha = 0 (fully see-through). It NEVER means: white pixels, light gray pixels, beige/skin-tone pixels, a checkerboard pattern, a frosted/blurred fill, a semi-opaque tint, or "drawing the skin underneath". If you find yourself painting ANY color inside a region that the brief said should be transparent — STOP and erase it to alpha = 0.
- DEFAULT BACKGROUND RULE: every pixel of the 585x559 canvas that is NOT inside a labeled garment cell MUST be alpha = 0. Do not paint a white sheet, do not paint a colored backdrop. Only the garment cells carry opaque pixels.
- When the user asks for a transparent area ("gola transparente", "manga curta", "regata", "sem manga", "barriga de fora", "crop top", "decote", "buraco", "see-through", "transparent", "no sleeves", "short sleeves", "tank top", "off-shoulder", "sleeveless", "cropped", "midriff", "mesh"), the corresponding cells/sub-regions MUST be alpha = 0 — never skin-colored, never white, never gray.
- "Manga curta" / "short sleeves": keep the shoulder cap and upper portion of the arm cells painted (the sleeve fabric), but make the LOWER portion of Arm FRONT / BACK / SIDE cells, and the Arm BOTTOM (cuff) cell, FULLY TRANSPARENT (alpha = 0). Add a clean horizontal hem line where the fabric ends.
- "Regata" / "tank top" / "sem manga": ALL six arm cells fully transparent (alpha = 0) on BOTH arms. Torso cells keep the shirt body, with armhole curves cut into the Torso TOP / SIDE cells using real alpha.
- "Gola transparente" / "decote" / "v-neck": cut a transparent neckline opening in Torso FRONT (and matching back if asked) and in Torso TOP using real alpha — the cut-out is alpha = 0, not painted skin.
- "Crop top" / "barriga de fora": lower portion of Torso FRONT / BACK / SIDE cells fully transparent, with a clean hem line above. The empty area below the hem MUST be alpha = 0 inside the cell.
- "Shorts" / "bermuda": lower portion of leg cells transparent below the desired hem (alpha = 0), with a clean hem line.
- "Mesh" / "see-through" / "fishnet": use real semi-transparent pixels (alpha between 0 and ~120) — actual alpha values, never a painted gray dot pattern over solid white.
- SELF-CHECK BEFORE OUTPUT: mentally overlay the image on a hot-pink background. Every area that is supposed to be transparent should show pink, not white/gray/skin. If you would see white where the brief said "transparent", the image is WRONG — regenerate with real alpha = 0.`;

const REAL_GARMENT_TRANSLATION = `REAL-TO-ROBLOX TRANSLATION:
- When the brief or reference image describes a real-world garment (e.g. "Nike tech fleece hoodie", "Carhartt jacket", "varsity jacket", "kimono", "soccer jersey", "military uniform"), translate it into a flat Roblox classic UV texture: extract the silhouette cues (collar shape, sleeve length, pockets, panels, color blocking, logo placement) and PAINT them as flat 2D art into the correct cells. Never render the real garment in 3D or on a person — only its flattened texture.
- Preserve key identifying details: contrast piping, sleeve stripes, chest logo position, zipper line down Torso FRONT, hood drape on Torso TOP/BACK, pocket squares on Torso FRONT, kangaroo pocket curve, ribbed cuffs at Arm BOTTOM, waistband at Torso BOTTOM.
- Convert photorealistic fabric (denim weave, leather grain, knit, mesh, camo) into a stylized FLAT painted version that still reads as that material at avatar scale.
- If the brief names a brand or copyrighted character, paint a generic look-alike (same silhouette/colors) instead of the literal logo to avoid moderation rejections.`;

const COMMON_FAILURES = `COMMON FAILURES TO AVOID (the model has been caught doing all of these — DO NOT REPEAT):
- Outputting a JPEG-style flat image with a solid white background instead of a true alpha PNG. Always emit real alpha.
- Filling "sleeveless" / "regata" arm cells with peach/beige skin color instead of leaving them alpha = 0.
- Painting a faux checkerboard pattern to "represent" transparency. Use real alpha = 0, not a pattern.
- Drawing the entire outfit on a 3D character/mannequin/avatar inside the cells instead of as flat UV panels.
- Cropping or rescaling the template so the cells move or the aspect ratio shifts. The 585x559 outer composition is LOCKED.
- Letting color or pattern bleed across the dotted cell borders into neighboring cells.
- Mirroring the LEFT arm/leg wrong (pockets on the wrong side, stripes flipped, asymmetric logo on both sides).
- Restarting a wraparound pattern inside the wrong cell instead of continuing it across the matched edge.
- Adding decorative text, watermarks, signatures, or brand wordmarks the user did not request.
- Producing washed-out / low-contrast colors. Use saturated, avatar-readable colors.
- Forgetting the cuff cell (Arm BOTTOM) when doing short sleeves — it must also be alpha = 0.`;

const FINAL_CHECKLIST = `FINAL CHECKLIST — verify EACH item before emitting the image:
[1] Canvas is exactly 585x559, outer composition pixel-identical to the official template.
[2] File is PNG-32 with a true alpha channel. Non-cell areas are alpha = 0 (never white).
[3] Every labeled cell is filled with the CORRECT face of the garment (front/back/top/bottom/side).
[4] Every user-requested transparent region is alpha = 0 — not painted skin, white, gray, or checkerboard.
[5] Adjacent cell edges of the same body part match in color, pattern phase, and stitching.
[6] Left side mirrors right side (unless asymmetry was requested).
[7] No 3D render, no character, no scene, no perspective, no photography.
[8] No unrequested text or logos.
If ANY item fails, fix it internally before output. Do not return a draft that fails the checklist.`;

const NAC_BLOCK = `NAC — NON-ARTIFICIAL CONTENT (HARD RULE, ZERO TOLERANCE):
- The garment MUST NEVER look flat, plastic, vector-clean, AI-smooth, "lisa", "chapada", or default-Roblox-cartoon-fill. If the texture could be mistaken for a single solid fill bucket, it is WRONG.
- Every painted cell MUST carry: visible fabric MESH/weave appropriate to the material (cotton weave, denim twill, knit ribs, fleece nap, leather grain, satin sheen, nylon ripstop grid, mesh net, jersey knit, etc.), painted micro-noise, fiber-level grain, and at least 3 tonal steps (deep shadow / mid / highlight) PER color region — never a single flat RGB.
- Required painted detail per panel: stitching lines along seams, hem topstitching, panel-break shading, fabric folds/wrinkles painted as 2D shading, subtle dirt/wear/used-look variation, and small irregularities (no perfect repeats).
- For any "leather", "metal", "armor", "denim", "knit", "silk", "wool", "vinyl", "pleather", "carbon", "camo": the corresponding material signature MUST be painted in (grain, twill, rib pattern, plate edges with rivets, weave) — never represented as a flat color.
- BANNED: solid flat color fills covering a whole panel, gradient-only fills with no texture, smooth airbrushed surfaces with no fiber, "cel-shaded" cartoon look unless explicitly requested, default Roblox shirt template aesthetic.
- If the brief is short or vague, DEFAULT to high-detail realistic fabric texture for the implied material rather than a flat fill. Detail is mandatory; "minimal" only applies to color palette, never to texture density.`;

const RPB_BLOCK = `RPB — REAL PNG BACKGROUND (HARD RULE, ZERO TOLERANCE):
- Output MUST be PNG-32 with a true per-pixel alpha channel, ready to upload directly to roblox.com/develop with no editing required.
- EVERY pixel outside the labeled garment cells MUST be alpha = 0 (fully transparent). No white sheet, no colored backdrop, no checkerboard, no skin tone — pure alpha = 0.
- EVERY region the user marked transparent ("manga curta", "regata", "sem manga", "gola transparente", "decote", "v-neck", "crop top", "barriga de fora", "shorts", "mesh", "buraco", "off-shoulder", "sleeveless", "tank top", "midriff", "see-through") MUST be alpha = 0 inside the corresponding cell(s). NEVER paint skin, white, gray, or a stylized hole there.
- Cut hems must be clean straight lines aligned to the garment edge; alpha cut-outs must respect symmetry on left/right cells.
- Mesh / see-through MUST use real semi-transparent alpha values (0–120), never a painted pattern over solid white.
- Self-check: imagine the output composited on a hot-pink background. Every supposed-transparent area MUST show pink. If it would show white/gray/skin, the file is REJECTED — regenerate with real alpha.`;

const RMTPC_BLOCK = `RMTPC — RECONHECIMENTO DE MARCAS, TEXTURAS E PADRÕES COMPLEXOS (HARD RULE):
- Before painting, mentally PARSE the brief AND each reference image for: (a) dominant + accent colors with exact hue/saturation, (b) fabric/material identity, (c) recurring patterns (stripes, plaid, camo, floral, geometric, paisley, animal print, abstract), (d) brand/logo cues (silhouette, badge, wordmark, tag placement), (e) depth/relief cues (quilting, embroidery, pockets, panels, piping, ribbing), (f) wear and used-look character.
- Reproduce EVERY captured signal in the correct cells: color palette must match within reasonable tolerance, patterns must continue across panel seams with correct scale and orientation, brand cues must be painted as generic-but-recognizable look-alike marks (no copyrighted wordmarks).
- Painted depth: use multi-layer shading to imply 3D relief (raised stitching, pocket shadow, quilt diamonds, embroidery thread direction, hood drape shadow) — flat 2D, but with painted depth that READS as 3D when wrapped on the avatar.
- Pattern continuity: a stripe wrapping the torso MUST continue in correct phase across front/back/side cells; plaid grid must line up across seams; logo on chest must NOT duplicate onto sleeves unless requested.
- Work harder, take more compute time, refine more passes if needed. Output a professional-grade garment, never a quick low-effort fill.`;

const HEAVY_TRAINING = `HEAVY TRAINING PASS (rigid baseline, always on):
- Treat this as a portfolio-grade commercial Roblox UGC asset, not a sketch. Quality bar: top-1% creator on the Roblox marketplace.
- Spend extra internal refinement passes on: color accuracy, panel alignment to the template grid, seam continuity, mirror symmetry, and alpha cleanliness. Time spent on quality is acceptable; cutting corners is not.
- Reject internally any draft that looks artificial, flat, or "AI-default". Repaint with more texture, more shading, more material identity before emitting.
- The result MUST be indistinguishable in quality from a hand-painted asset by a senior Roblox clothing artist.`;

const HEAVY_TRAINING_V2 = `HEAVY TRAINING PASS V2 (continuous training — additive, never softens prior rules):
- You are being repeatedly trained. Each generation is graded on: (1) zero artificial/flat look, (2) real PNG-32 alpha cleanliness, (3) per-cell face correctness (front/back/top/bottom/side never swapped), (4) seam pixel-match, (5) reference fidelity, (6) painted material identity (mesh/weave/grain visible).
- Internally simulate the wrap onto a Roblox R6 avatar before emitting: if a seam would visibly break, repaint until it doesn't.
- Treat every active flag (NAC, RPB, RMTPC, DRA, RPI) as a HARD CONSTRAINT that compounds — when multiple flags are active, ALL their checklists must pass simultaneously.
- Bias toward MORE compute, MORE refinement passes, MORE painted micro-detail. A slightly slower, clearly superior output is always preferred over a fast generic one.
- Never emit a draft. Self-grade against the FINAL CHECKLIST and every active flag block. If any item would fail, repaint internally and re-grade. Only emit when all checks pass.`;

const REGION_LABEL: Record<InpaintRegion, string> = {
  torso: "TORSO group (Torso FRONT / BACK / TOP / BOTTOM / LEFT SIDE / RIGHT SIDE)",
  right_arm: "RIGHT ARM group (all six arm faces)",
  left_arm: "LEFT ARM group (all six arm faces, mirrored)",
  right_leg: "RIGHT LEG group (all six leg faces)",
  left_leg: "LEFT LEG group (all six leg faces, mirrored)",
};

const INPAINT_BLOCK = (region: InpaintRegion, refinement: string) => `RPI — REPAINT PARTIAL / INPAINT LOCAL (HARD RULE, ZERO TOLERANCE):
- A SECOND image is attached after the official template: it is the PREVIOUS generated result for this same garment. Treat it as the LOCKED baseline.
- You MUST regenerate ONLY the ${REGION_LABEL[region]} cells. EVERY other cell of the template MUST remain VISUALLY IDENTICAL to the previous-result image — same pixels, same colors, same patterns, same alpha. Do NOT "improve", retouch, relight, recolor, or redraw them.
- Transparent (alpha = 0) areas outside the labeled cells MUST stay alpha = 0 — never paint a background or add a sheet.
- Inside the target region, repaint from scratch following ALL prior rules (NAC mesh/material detail, RPB real alpha for any requested cut-outs, RMTPC pattern/brand fidelity, FINAL CHECKLIST).
- Continuity at the borders with neighboring (untouched) regions MUST match — colors, stitching lines, panel breaks, and pattern phase at the seam must read as one outfit.
- Mirror discipline still applies inside the region (e.g. repainting "left arm" must mirror the existing right arm unless asymmetry was explicitly requested).
- Refinement brief for the target region (apply on top of the original brief): "${refinement || "Same brief as before, higher fidelity, more detail, fix any artifacts."}"
- Output a full 585x559 PNG-32 (NOT a crop) where ONLY the target region differs from the baseline image.`;

const DRA_BLOCK = `DRA — DEEP REFERENCE ANALYSIS (HARD RULE, image-to-project mode):
- Before painting ANY pixel of the template, perform a deep multi-pass analysis of EVERY reference image attached after the official template. Treat this as an image-to-project workflow: a real-world garment must be faithfully translated into a Roblox classic UV.
- Mandatory analysis checklist for each reference:
  [a] Garment type, silhouette, cut (hoodie / bomber / blazer / tee / tank / cargo / jeans / shorts / etc.) and length.
  [b] Full color palette with primary + accent + trim colors (note hue, saturation, value).
  [c] Fabric / material identity (cotton, denim weave direction, fleece, leather, satin, nylon, mesh, knit rib, twill, ripstop, velvet, suede, etc.) and its visual signature.
  [d] All patterns (stripes, plaid, camo, floral, geometric, tie-dye, abstract) with scale, orientation, and repeat.
  [e] Construction details: seams, topstitching, panel breaks, paneling color blocks, piping, ribbing on cuffs/hem/collar, zipper line, button placket, drawstrings, hood drape, kangaroo pocket, chest pocket, cargo pockets, belt loops.
  [f] Brand / logo cues: chest mark, sleeve mark, back print, tag — reproduce as generic-but-recognizable look-alike (no copyrighted wordmarks).
  [g] Depth and relief: quilting, embroidery, layered fabric, hood shadow, wrinkles, wear/used look.
  [h] Transparency cues: short sleeves, sleeveless, crop, decote, mesh inserts, cut-outs — these MUST become real alpha = 0 regions in the output (see RPB).
- After analysis, MAP each captured element onto the correct template cells: front-of-garment → Torso FRONT, sleeves → Arm cells (mirrored), back prints → Torso BACK, etc. Patterns must continue across seams with correct phase.
- Spend AT LEAST 25 seconds of compute on this analysis + generation cycle. Do NOT rush. If the result still looks low-fidelity to the reference, internally refine and repaint until it matches. Extra time is acceptable and expected.
- The final output must read as "this is clearly the same garment from the reference, faithfully rebuilt as a Roblox classic template" — not a loose inspiration.`;
const SYSTEM = (type: "shirt" | "pants") => `You generate ROBLOX CLASSIC ${type.toUpperCase()} TEMPLATES (flat 2D UV textures uploaded to roblox.com/develop, then wrapped onto avatars).
${CRITICAL_2D}
${TEMPLATE_RULES}
${type === "shirt" ? SHIRT_HINT : PANTS_HINT}
${PANTS_VS_SHIRT_DISCIPLINE.replace("${MODE}", type.toUpperCase())}
${COHERENCE}
${TRANSPARENCY}
${REAL_GARMENT_TRANSLATION}
${COMMON_FAILURES}
${HEAVY_TRAINING}
${FINAL_CHECKLIST}
Style rules: flat 2D painted texture, visible fabric/material details PAINTED ON (stitching, rivets, weave drawn as 2D art — never modeled in 3D), perfectly straight panel edges aligned to the template grid, no shading bleed across cells, no avatar redraw, NO 3D RENDER, NO PHOTOGRAPHY, NO CHARACTER ILLUSTRATION, NO SCENE. Output IS the upload-ready 585x559 PNG-32 (REAL alpha channel — non-cell area and ALL requested cut-outs MUST be alpha = 0, never white/gray/skin) with the SAME outer composition as the official template image provided.`;

const CHROMA_BLOCK = `CHROMA ALPHA KEY (HARD RULE — OVERRIDES ANY OTHER TRANSPARENCY INSTRUCTION):
- You CANNOT output a real alpha channel, so DO NOT TRY. Instead, paint EVERY pixel that must end up transparent in PURE CHROMA MAGENTA, exact RGB (255, 0, 255) / hex #FF00FF. A post-process step keys that exact color out and replaces it with true alpha = 0.
- Paint #FF00FF (never white, never gray, never light beige, never skin, never a checkerboard, never a "transparent-looking" pattern) in:
  [a] the ENTIRE area outside the labeled garment cells (all template background, margins, gutters between cells),
  [b] the whole upper TORSO panel group when generating PANTS,
  [c] every region the brief marks as cut-out: short sleeves below the hem, sleeveless/tank arm cells, necklines/decote, crop-top area below the hem, shorts below the cuff, holes, off-shoulder gaps.
- The magenta MUST be flat, 100% saturated, uniform #FF00FF with NO gradient, NO shading, NO noise, NO texture, NO antialias gradient bleeding far into the garment. Hard, crisp edges between garment and magenta.
- NEVER use magenta as a design color anywhere in the garment. If the brief asks for pink/magenta clothing, use a clearly different tone (e.g. #E255C8 or #FF3399) so the key does not eat the garment.
- BANNED (instant rejection): white background, gray background, checkerboard pattern, "PNG transparency illustration", any painted imitation of transparency. Only #FF00FF means transparent.
- The dotted template guide lines, labels, logo and the small isometric avatar diagrams should ALSO be replaced by #FF00FF — the final upload must contain the garment panels only, everything else keyed out.`;

const LIMB_BLOCK = `LIMB GEOMETRY LOCK (HARD RULE — fixes the #1 defect: broken sleeves, cuffs, wrists, hand holes and leg panels):
- Each limb is an unfolded rectangular BOX with SIX faces: FRONT, BACK, LEFT SIDE, RIGHT SIDE, TOP (shoulder cap / hip top), BOTTOM (wrist-hand opening / ankle-foot opening). All six MUST be painted consistently; a missing or mismatched face is what produces the "bugged sleeve" look on the avatar.
- The four LONG faces of an arm (FRONT, BACK, both SIDES) all run shoulder → wrist in the SAME direction. The shoulder end of all four must share the same color/pattern row, and the wrist end of all four must share the same cuff row, at the SAME height in pixels. If a stripe or cuff band sits 12 px from the bottom on one face, it sits 12 px from the bottom on the other three.
- WRIST / HAND OPENING: the ARM BOTTOM square is the hole the hand comes out of. For a normal long sleeve it is the INSIDE of the cuff — paint it as the darker inner-fabric tone of the sleeve, ringed by the cuff color. NEVER paint a hand, fingers, skin, a glove seam, or garment art there. For short sleeves / sleeveless it is fully keyed out (magenta / alpha 0).
- SHOULDER CAP: the ARM TOP square is seen from above; it must continue the shoulder color of the torso side it attaches to, so the shoulder seam disappears. Never put a cuff, logo, or hem there.
- CUFF BANDS: if the design has ribbed cuffs, the band wraps ALL FOUR long faces at identical height, and the ARM BOTTOM inner face uses the same band color. Never a cuff on only one face.
- LEG PANELS (pants): identical logic. The four long faces run hip → ankle in the same direction; waistband at the TOP row of all four faces at identical height; cuff/hem at the BOTTOM row of all four at identical height. LEG BOTTOM square = the foot opening, painted as the inner fabric/sole shadow tone — never a shoe, never a foot, never skin. LEG TOP square = the hip cap, continuing the waistband.
- INNER vs OUTER SIDE: for each limb, one side face is the INNER side (faces the body) and one is the OUTER side (faces away). Side stripes, cargo pockets and piping belong on the OUTER side only, and must be MIRRORED to the correct outer side on the opposite limb — never on both inner sides, never on the same physical side twice.
- Mirror check: after painting the left limb, mentally flip it and compare to the right limb. Front must map to front, outer to outer. A limb whose FRONT face is actually the BACK face flipped is REJECTED.
- Sleeve length changes ONLY happen along the long axis, cutting all four long faces at the SAME height with one clean horizontal hem, plus keying out the BOTTOM face when the cut removes the cuff. Never cut a sleeve diagonally or at different heights per face.
- SELF-CHECK: simulate folding each limb box back into 3D. Every seam must line up; the wrist ring must be one continuous band; nothing may read as "chopped", offset by a few pixels, or rotated 90°. Repaint until it folds cleanly.`;

const LEARN_BLOCK = (rules: string[]) => `AUTO-LEARNING MEMORY (accumulated corrections from this creator's previous generations — treat as HARD RULES, they encode defects already observed and must never repeat):
${rules.map((r, i) => `[L${i + 1}] ${r}`).join("\n")}
- These learned rules take priority over generic style preferences. Every new generation must satisfy all of them in addition to the base checklist.`;

const CATALOG_NOTE = `CATALOG REFERENCE CONTEXT: some of the attached reference images are real Roblox classic clothing assets pulled from the Roblox catalog for this brief. Study them for the platform-native conventions (panel proportions, how details are stylized at avatar scale, contrast level, how cuffs/collars/waistbands are drawn as flat art) and match that production standard — but design the requested garment from the user's brief, do NOT copy any catalog asset one-to-one.`;


export const Route = createFileRoute("/api/generate-clothing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body?.prompt || !body?.type) {
          return new Response("Missing prompt or type", { status: 400 });
        }

        const userRefs = body.references ?? [];
        const modelChoice: ModelChoice = body.model === "gpt" ? "gpt" : "gemini";
        const flags: Flags = body.flags ?? {};
        const draActive = !!flags.dra && userRefs.length > 0;
        const inpaint = body.inpaint;
        const inpaintActive = !!inpaint?.baseImage && !!inpaint?.region;
        const learned = (body.learned ?? [])
          .map((r) => String(r).trim())
          .filter(Boolean)
          .slice(-14);
        const learnActive = !!flags.learn && learned.length > 0;
        const flagBlocks = [
          flags.chroma ? CHROMA_BLOCK : "",
          flags.limb ? LIMB_BLOCK : "",
          flags.nac ? NAC_BLOCK : "",
          flags.rpb && !flags.chroma ? RPB_BLOCK : "",
          flags.rmtpc ? RMTPC_BLOCK : "",
          draActive ? DRA_BLOCK : "",
          userRefs.length ? CATALOG_NOTE : "",
          learnActive ? LEARN_BLOCK(learned) : "",
          inpaintActive ? INPAINT_BLOCK(inpaint!.region, inpaint!.refinement ?? "") : "",
        ].filter(Boolean).join("\n\n");


        // Extra grid-discipline nudge for GPT-Image (tends to stylize away from the template).
        const GPT_EXTRA = `\n\nSTRICT GRID LOCK (model-specific): The first attached image IS the canonical 585x559 UV template. Reproduce its outer composition, dotted cell borders, label positions, and aspect ratio with PIXEL-LEVEL fidelity. Do NOT crop, rescale, or recompose. Only fill the empty cells. Keep everything outside the labeled cells visually identical to the template image.`;

        const userText = `${SYSTEM(body.type)}${modelChoice === "gpt" ? GPT_EXTRA : ""}\n\n${HEAVY_TRAINING_V2}${flagBlocks ? `\n\nACTIVE PRO MODES (MANDATORY — override any softer rule above):\n${flagBlocks}` : ""}

USER DESIGN BRIEF: ${body.prompt}

${inpaintActive ? `INPAINT MODE: the image attached IMMEDIATELY AFTER the official template is the PREVIOUS generated result. Treat it as a locked baseline; modify ONLY the ${REGION_LABEL[inpaint!.region]} cells and keep every other pixel identical.` : ""}

${userRefs.length ? `Additional reference image(s) (${userRefs.length}) follow${inpaintActive ? " the previous-result image" : " the official template"}. Use them ONLY as a style guide — extract color palette, fabric texture (denim, leather, cotton, hoodie fleece, etc.), patterns, and aesthetic. Do NOT copy their layout. Remap the extracted style onto the template cells.` : ""}

Render the final Roblox ${body.type} template now, identical in outer composition to the official template image${inpaintActive ? ", keeping non-target cells pixel-identical to the previous-result image" : ""}, with the cells filled per the brief.`;

        // ALWAYS send the official template as the first image so the model locks the layout.
        const content: Array<Record<string, unknown>> = [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: TEMPLATE_B64 } },
        ];
        if (inpaintActive) {
          content.push({ type: "image_url", image_url: { url: inpaint!.baseImage } });
        }
        for (const url of userRefs) {
          content.push({ type: "image_url", image_url: { url } });
        }

        const modelId =
          modelChoice === "gpt"
            ? "openai/gpt-image-2"
            : "google/gemini-3.1-flash-image-preview";

        const requestBody: Record<string, unknown> = {
          model: modelId,
          messages: [{ role: "user", content }],
          modalities: ["image", "text"],
        };
        if (modelChoice === "gpt") {
          requestBody.quality = "low";
        }


        const startedAt = Date.now();
        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });



        const raw = await upstream.text();
        if (!upstream.ok) {
          console.error("AI gateway error", upstream.status, raw);
          return Response.json(
            { error: `Gateway ${upstream.status}: ${raw.slice(0, 500)}` },
            { status: upstream.status === 429 || upstream.status === 402 ? upstream.status : 502 },
          );
        }

        let json: {
          data?: Array<{ b64_json?: string; url?: string }>;
          choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
          error?: { message?: string };
        };
        try {
          json = JSON.parse(raw);
        } catch {
          console.error("Non-JSON response", raw.slice(0, 500));
          return Response.json({ error: "Resposta inválida do provedor de IA." }, { status: 502 });
        }

        // Try OpenAI-images shape first (Gateway normalizes Gemini into this shape).
        let b64 = json?.data?.[0]?.b64_json;

        // Some Gemini responses may include a data URL instead of raw b64.
        if (!b64) {
          const url =
            json?.data?.[0]?.url ??
            json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          if (url?.startsWith("data:image")) {
            b64 = url.split(",")[1];
          }
        }

        if (!b64) {
          console.error("No image in response", JSON.stringify(json).slice(0, 800));
          return Response.json(
            {
              error:
                json?.error?.message ??
                "O modelo não retornou uma imagem. Tente reformular o prompt (evite nomes próprios ou conteúdo bloqueado).",
            },
            { status: 502 },
          );
        }

        // DRA enforces a minimum 25s analysis window when references are present.
        if (draActive) {
          const elapsed = Date.now() - startedAt;
          const floor = 25_000;
          if (elapsed < floor) {
            await new Promise((r) => setTimeout(r, floor - elapsed));
          }
        }

        return Response.json({ b64 });
      },
    },
  },
});

# Super Enchantments

Every enchantment goes up to level 20, three new enchantments join the
list, and the place to get them is the Super Enchantment Fountain at the
top of an Enchantment Tower.

## The Enchantment Tower

Enchantment Towers generate on the surface of every Overworld land biome
(oceans, rivers and beaches are skipped so they do not float on water),
roughly one per 250 chunks, a 9×9 stone-brick tower about twenty blocks
tall. Enter through the doorway, climb the ladder on the north wall
through two hatches, and the open roof holds the fountain in a ring of sea
lanterns and bookshelves. The tower is buried four blocks into the ground,
so on a slope one side shows its cobblestone foundation, like a vanilla
outpost.

Towers only appear in chunks generated **after** the add-on is installed.
To get one on explored land, stand where you want it and run:

```
/scriptevent steveo:enchant tower
```

It rises around you with its ground floor at your feet.

## The Super Enchantment Fountain

Hold the item you want to enchant and use the fountain. A menu lists every
enchantment that item can take: the vanilla ones the game would allow, plus
the new ones below. Enchantments already on the item are listed first with
their current level. Pick one and a slider offers every level from the
next one up to 20.

The price is **2 lapis lazuli per level gained**, taken from your
inventory: taking a fresh sword to Sharpness XX costs 40 lapis, and taking
it from XV to XX later costs 10. The item is never consumed; it is
enchanted in place. Books are refused, since the fountain enchants gear
directly. Curses are never offered.

Every successful enchantment sends a random number of glowing enchantment
letters shooting out of the fountain. They are decoration.

### How levels above the vanilla max work

Bedrock refuses to put Sharpness VI on a sword, so a super level is two
things at once: the vanilla enchantment at its own maximum (the game keeps
doing what it does), plus a record on the item that shows as a lore line
such as **✦ Sharpness XX**. The add-on's script reads that record and adds
the missing power itself. What the extra levels do:

| Enchantment | Each level above the vanilla max |
|---|---|
| Sharpness | +1.25 melee damage |
| Smite, Bane of Arthropods | +2.5 damage to undead / arthropods |
| Knockback, Punch | much more knockback |
| Fire Aspect, Flame | +4 seconds of burning |
| Power | +25% arrow damage |
| Protection | 4% less damage from anything |
| Fire, Blast, Projectile Protection, Feather Falling | 8% less damage from that cause |
| Thorns | +1 damage back to whoever hits you |
| Efficiency | Haste while the tool is in hand (up to Haste V) |
| Respiration | Water Breathing while in water |
| Unbreaking | The item slowly repairs itself while held or worn |

Scripted damage reduction from armor is capped at 80% so no set makes you
immortal. Everything else (Silk Touch, Fortune, Looting, Mending, Infinity,
Depth Strider, and so on) accepts level 20, shows it in the lore, and is
otherwise the vanilla enchantment at its own maximum: nothing sensible
scales, so the extra levels are cosmetic there.

## The new enchantments

These exist only through the fountain and the lore line it writes; a
grindstone will not remove them.

**Power Knockback** (swords, axes, maces, tridents): every melee hit
launches the target super duper far, and further with each level. Level
XX sends mobs into the next biome.

**Extra Hit** (swords, axes, maces, tridents): each melee hit has a chance
to strike every mob around the target as well, for three quarters of the
hit's damage. Level I is a 1-in-4 chance within 2.5 blocks; each level adds
3.5% and 0.4 blocks, so level XX is nearly certain and reaches ten blocks.
Other players are never caught in it.

**Super Efficiency** (pickaxes): lets you mine bedrock. Hit a bedrock block
with the pickaxe and keep your crosshair on it: a progress bar in the
action bar counts down, and when it finishes the block breaks and drops as
an item. Level I takes 3 minutes; each further level shaves 4% off, so
level XX takes about 43 seconds. Looking away for more than five seconds
abandons the attempt.

## Debug commands

Chat is the only console on a Realm, so the add-on answers to a script event:

```
/scriptevent steveo:enchant tower               # raise an Enchantment Tower around you
/scriptevent steveo:enchant fountain            # put a fountain on the block you are looking at
/scriptevent steveo:enchant lapis               # 64 lapis lazuli
/scriptevent steveo:enchant bedrock             # put a bedrock block on the block you are looking at
/scriptevent steveo:enchant letters             # the enchantment-letter burst, at you
/scriptevent steveo:enchant info                # every enchantment on the held item, with levels
/scriptevent steveo:enchant apply sharpness 20  # enchant the held item for free
/scriptevent steveo:enchant apply extra_hit 5   # the new ones work by name too
```

## Files

| Path | What it is |
|---|---|
| `behavior_pack/blocks/enchantment_fountain.json` | The fountain block: glow, hardness, custom model |
| `behavior_pack/features/` and `feature_rules/` | Scatters the tower across Overworld land biomes |
| `behavior_pack/structures/steveo/enchantment_tower.mcstructure` | The tower itself (generated) |
| `resource_pack/models/blocks/enchantment_fountain.geo.json` | Pedestal, stem, basin, and glowing pool |
| `resource_pack/particles/enchantment_letters.json` | The letter burst, sampling 16 glyphs from one sheet |
| `resource_pack/textures/` | Fountain texture and glyph sheet (generated) |
| `resource_pack/texts/en_US.lang` | Every player-facing string, including all enchantment names |
| `src/main.ts` | The fountain menu, the super-level record, every effect, and the debug command |

Regenerate the icons, textures, and the tower with
`node addons/super-enchantments/assets/generate.mjs addons/super-enchantments`.
The tower is laid out in that script; edit it there, rerun, and commit the
new `.mcstructure`.

## Not yet verified in-game

`pnpm check` passes, but the pieces below only prove out in the game:

- World generation of the tower (the feature rule's `heightmap` placement
  and biome filter) and the `.mcstructure` written by the generator.
- The fountain's custom geometry and texture, and the letter particle.
- `entityHitBlock` firing on bedrock for the Super Efficiency timer.
- Lore lines written as translatable `RawMessage`s rather than plain text.

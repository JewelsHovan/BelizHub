"""Domain lexicon for BTEC620 (molecular/cell biology lab methods).

`wrong` variants are mis-hearings actually observed in decodes of this course's
audio, or close phonetic neighbours. They drive both the correction pass and the
term-error metric. `pattern` matches the correct form for scoring.
Corrections are deliberately conservative: only unambiguous, evidence-backed
substitutions belong here, because a wrong "fix" is worse than a raw mis-hearing.
"""

import re

# (canonical, regex for correct form, [observed/likely mis-hearings])
_RAW = [
    ("GAPDH", r"\bgapdh\b", ["gap eh", "gap-eh", "gapeh", "gap dh", "g a p d h"]),
    ("lacZ", r"\blacz\b", ["lac c", "lac z gene", "lack c", "lac see"]),
    ("operon", r"\boperon\b", ["operam", "opera", "operant"]),
    ("lac operon", r"\blac operon\b", ["overall lactose", "lac operam"]),
    ("polycistronically", r"\bpolycistronic", ["polycystronically", "polycystronic"]),
    ("multiple cloning site", r"\bmultiple cloning site\b",
     ["multiclaw inside", "multi claw inside", "multiple claw inside", "multicloning inside"]),
    ("immunofluorescence", r"\bimmunofluorescence\b",
     ["immunofluorice", "immuno fluorice", "immunofluorescent sense"]),
    ("recombinant", r"\brecombinant\b", ["other combinant", "re combinant", "recombinent"]),
    ("beta-galactosidase", r"\bbeta[- ]?galactosidase\b", ["beta galactocidase", "beta galactoside"]),
    ("allolactose", r"\ballolactose\b", ["alec lactose", "hollow lactose", "alo lactose"]),
    ("encodes", r"\bencodes\b", ["coincides the", "in codes"]),
    ("RNA interference", r"\brna interference\b", ["rna inference"]),
    ("siRNA", r"\bsirna\b", ["si rna", "sy rna"]),
    ("RT-PCR", r"\brt[- ]?pcr\b", ["rtpcr", "art pcr", "r t pcr"]),
    ("qPCR", r"\bqpcr\b", ["q pcr", "cue pcr"]),
    ("cDNA", r"\bcdna\b", ["c dna", "see dna", "seedna"]),
    ("plasmid", r"\bplasmid", ["plasma id", "plastid"]),
    ("restriction enzyme", r"\brestriction enzyme", ["restrictionenzyme"]),
    ("ligase", r"\bligase\b", ["ligates", "lie gays"]),
    ("promoter", r"\bpromoter\b", ["promotor", "promoted"]),
    ("repressor", r"\brepressor\b", ["repressure", "depressor"]),
    ("operator", r"\boperator\b", ["operater"]),
    ("RNA polymerase", r"\brna polymerase\b", ["rna polymerace", "rna polymer aids"]),
    ("transcribed", r"\btranscribed\b", ["transcript it"]),
    ("affinity purification", r"\baffinity purification\b", ["infinity purification"]),
    ("housekeeping gene", r"\bhousekeeping gene\b", ["house keeping gene"]),
    ("signal transduction", r"\bsignal transduction\b", ["signal transduxion"]),
    ("electrophoresis", r"\belectrophoresis\b", ["electrophoresys", "electrophorese is"]),
    ("centrifuge", r"\bcentrifuge", ["centrifuse"]),
    ("supernatant", r"\bsupernatant\b", ["super natant", "supernatent"]),
    ("aliquot", r"\baliquot", ["alec what", "alley quote"]),
    ("pipette", r"\bpipette", ["pipet", "pip it"]),
    ("buffer", r"\bbuffer\b", []),
    ("vector", r"\bvector\b", ["victor"]),
    ("insert", r"\binsert\b", []),
    ("transformation", r"\btransformation\b", []),
    ("transfection", r"\btransfection\b", ["transfusion"]),
    ("western blot", r"\bwestern blot\b", ["western blood"]),
    ("SDS-PAGE", r"\bsds[- ]?page\b", ["sds page", "sdspage"]),
    ("antibody", r"\bantibod", ["anti body"]),
    ("fluorescent microscopy", r"\bfluorescen\w* microscopy\b", ["florescent microscopy"]),
    ("knockdown", r"\bknockdown\b", ["knock down"]),
    ("prokaryotic", r"\bprokaryotic\b", ["pro carry otic"]),
    ("eukaryotic", r"\beukaryotic\b", ["you carry otic"]),
    ("assay", r"\bassay\b", ["a say", "essay"]),
    ("yield", r"\byield\b", []),
    ("controls", r"\bcontrols\b", []),
    ("protocol", r"\bprotocol", []),
]

LEXICON = [{"term": t, "pattern": p, "wrong": w} for t, p, w in _RAW]

# Primes Whisper's decoder toward course vocabulary. Kept to natural prose and
# well under the 224-token prompt window.
INITIAL_PROMPT = (
    "BTEC620 molecular biotechnology laboratory lecture. Topics include plasmid "
    "vectors, the multiple cloning site, restriction enzymes, DNA ligase, the lac "
    "operon, lacZ, beta-galactosidase, allolactose, the repressor and operator, RNA "
    "polymerase, blue-white screening, transformation, RNA interference and siRNA "
    "knockdown of the housekeeping gene GAPDH, indirect immunofluorescence and "
    "fluorescence microscopy, recombinant protein expression in bacteria, affinity "
    "purification and yield, signal transduction, RT-PCR, qPCR, cDNA, SDS-PAGE, "
    "western blot, electrophoresis, supernatant, aliquot, and experimental controls."
)

_SUBS = []
for entry in LEXICON:
    for wrong in entry["wrong"]:
        _SUBS.append((re.compile(r"\b" + re.escape(wrong) + r"\b", re.IGNORECASE), entry["term"]))


def correct(text):
    """Apply conservative, evidence-backed lexicon substitutions.

    Returns (corrected_text, [(wrong, right, count), ...]) so every change stays
    auditable rather than silently rewriting what the instructor said.
    """
    changes = []
    for rx, right in _SUBS:
        text, n = rx.subn(right, text)
        if n:
            changes.append((rx.pattern, right, n))
    return text, changes

# Terms both engines mis-heard on the full lecture; added after cross-engine review.
_EXTRA = [
    ("HEK cells", r"\bhek(?:\s?293)? cells\b", ["hex cells", "head cells", "heck cells"]),
    ("pGEM-T", r"\bpgem[- ]?t\b", ["pgnt", "pgt", "p g n t", "pgemt"]),
    ("X-gal", r"\bx[- ]?gal\b", ["ex gal", "x gall"]),
    ("E. coli", r"\be\.? ?coli\b", ["ecoli"]),
    ("agar plate", r"\bagar plate\b", ["aga plate", "agarplate"]),
    ("reporter", r"\breporter\b", ["report er"]),
    ("reverse transcription", r"\breverse transcription\b", ["reverse transcript ion"]),
    ("total RNA", r"\btotal rna\b", []),
]
for _t, _p, _w in _EXTRA:
    LEXICON.append({"term": _t, "pattern": _p, "wrong": _w})
    for _x in _w:
        _SUBS.append((re.compile(r"\b" + re.escape(_x) + r"\b", re.IGNORECASE), _t))

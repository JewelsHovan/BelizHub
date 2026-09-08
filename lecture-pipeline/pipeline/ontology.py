"""Check biological names against authoritative databases, not model memory.

A reviewing model will confidently endorse a gene that does not exist, and will
equally confidently reject a real but unfamiliar one. These are the public
registries that actually decide the question:

  HGNC     human gene symbols            rest.genenames.org
  UniProt  proteins and genes, any organism  rest.uniprot.org
  PubChem  reagents and small molecules   pubchem.ncbi.nlm.nih.gov

All keyless. Results are cached on disk so a course's vocabulary is looked up
once, not once per lecture.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from difflib import get_close_matches
from pathlib import Path

# Common words that also happen to appear inside database entry names. Without
# this, "receptor" validates as "Prostacyclin receptor" and "laxative" as
# "Laxative peptide", certifying a mis-hearing as real biology.
GENERIC = {
    "receptor", "protein", "gene", "vector", "plasmid", "enzyme", "buffer",
    "cell", "cells", "assay", "control", "controls", "primer", "primers",
    "sample", "product", "insert", "marker", "medium", "membrane", "kit",
    "laxative", "sequence", "reaction", "solution", "tube", "column", "band",
    "signal", "activity", "analysis", "culture", "strain", "colony", "clone",
}

CACHE = Path(__file__).resolve().parent.parent / "work" / "ontology_cache.json"
TIMEOUT = 20
UA = "BelizHub-lecture-pipeline/1.0 (student study tool; contact via repo)"
_cache = None


def _canon(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _load():
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(CACHE.read_text())
        except Exception:
            _cache = {}
    return _cache


def _save():
    if _cache is not None:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(_cache, indent=1, sort_keys=True))


def _get(url, accept="application/json", retries=2):
    cache = _load()
    if url in cache:
        return cache[url]
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = json.loads(r.read().decode("utf-8"))
            cache[url] = data
            _save()
            return data
        except Exception:
            if attempt == retries:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def hgnc_symbol(symbol):
    """Exact human gene symbol lookup. Returns record or None."""
    q = urllib.parse.quote(symbol)
    d = _get(f"https://rest.genenames.org/search/symbol/{q}")
    if not d:
        return None
    docs = d.get("response", {}).get("docs", [])
    for doc in docs:
        if doc.get("symbol", "").upper() == symbol.upper():
            return {"source": "HGNC", "symbol": doc["symbol"],
                    "name": doc.get("name", ""), "id": doc.get("hgnc_id", "")}
    return None


def hgnc_alias(symbol):
    """Old or alias symbol -> current approved symbol.

    The search endpoint scores loosely: querying "Taq" returned LEO1. So the
    candidate's own alias/previous-symbol lists are fetched and required to
    contain the query EXACTLY before the match is accepted.
    """
    q = urllib.parse.quote(symbol)
    want = symbol.upper()
    for field in ("alias_symbol", "prev_symbol"):
        d = _get(f"https://rest.genenames.org/search/{field}/{q}")
        for doc in (d or {}).get("response", {}).get("docs", [])[:5]:
            sym = doc.get("symbol")
            if not sym:
                continue
            full = _get("https://rest.genenames.org/fetch/symbol/"
                        + urllib.parse.quote(sym))
            for fdoc in (full or {}).get("response", {}).get("docs", []):
                pool = [a.upper() for a in
                        (fdoc.get("alias_symbol", []) + fdoc.get("prev_symbol", []))]
                if want in pool:
                    return {"source": f"HGNC:{field}", "symbol": sym,
                            "name": fdoc.get("name", ""),
                            "id": fdoc.get("hgnc_id", "")}
    return None


def _protein_names(entry):
    out = []
    desc = entry.get("proteinDescription", {})
    for key in ("recommendedName", "submissionNames"):
        val = desc.get(key)
        for item in (val if isinstance(val, list) else [val]):
            if isinstance(item, dict):
                full = item.get("fullName", {}).get("value")
                if full:
                    out.append(full)
    for alt in desc.get("alternativeNames", []) or []:
        full = alt.get("fullName", {}).get("value")
        if full:
            out.append(full)
    return out


def _gene_names(entry):
    out = []
    for g in entry.get("genes", []) or []:
        name = g.get("geneName", {}).get("value")
        if name:
            out.append(name)
        for syn in g.get("synonyms", []) or []:
            if syn.get("value"):
                out.append(syn["value"])
    return out


def uniprot(term, organism=None):
    """Protein or gene in any organism - covers bacterial genes like lacZ.

    Uses gene_exact and requires the returned record to actually carry the term
    as a gene name, or as a WHOLE WORD of a protein name. UniProt's default
    scoring matched "laxative" to a "Laxative peptide" entry, which would have
    certified an ASR error as real biology.
    """
    query = f'(gene_exact:{term} OR protein_name:"{term}")'
    if organism:
        query += f" AND organism_id:{organism}"
    url = ("https://rest.uniprot.org/uniprotkb/search?query="
           + urllib.parse.quote(query)
           + "&fields=accession,id,protein_name,gene_names,organism_name&size=5&format=json")
    d = _get(url)
    want = term.lower()
    word = re.compile(r"\b" + re.escape(want) + r"\b", re.IGNORECASE)
    for entry in (d or {}).get("results", []):
        genes = [g.lower() for g in _gene_names(entry)]
        names = _protein_names(entry)
        exact_gene = want in genes
        exact_name = any(word.search(n) for n in names)
        if not (exact_gene or exact_name):
            continue
        return {"source": "UniProt",
                "accession": entry.get("primaryAccession", ""),
                "name": names[0] if names else entry.get("uniProtkbId", ""),
                "organism": entry.get("organism", {}).get("scientificName", ""),
                "matched": "gene symbol" if exact_gene else "protein name"}
    return None


def pubchem(name):
    """Reagents, buffers, substrates: IPTG, X-gal, guanidine thiocyanate.

    PubChem's name lookup is forgiving - "beta-galactosidase" resolved to
    glucose. So the compound's own synonym list is fetched and required to
    contain the query exactly.
    """
    q = urllib.parse.quote(name)
    d = _get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{q}"
             f"/property/MolecularFormula,IUPACName/JSON")
    props = (d or {}).get("PropertyTable", {}).get("Properties", [])
    if not props:
        return None
    cid = props[0].get("CID")
    syn = _get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON")
    names = []
    try:
        names = syn["InformationList"]["Information"][0]["Synonym"]
    except Exception:
        names = []
    # No synonym list means the match cannot be verified. Accepting it anyway is
    # how "beta-galactosidase" resolved to glucose, so unverifiable is rejected.
    want = _canon(name)
    if not names or not any(_canon(n) == want for n in names):
        return None
    return {"source": "PubChem", "cid": cid,
            "formula": props[0].get("MolecularFormula", ""),
            "iupac": props[0].get("IUPACName", "")}


def suggest_gene(symbol, limit=3):
    """Nearest approved human symbols, for a token that validated nowhere."""
    q = urllib.parse.quote(symbol)
    d = _get(f"https://rest.genenames.org/fetch/symbol/{q}*") or {}
    docs = d.get("response", {}).get("docs", [])
    names = [doc["symbol"] for doc in docs if doc.get("symbol")]
    if not names:
        d = _get(f"https://rest.genenames.org/search/{q}") or {}
        names = [doc["symbol"] for doc in
                 d.get("response", {}).get("docs", [])[:25] if doc.get("symbol")]
    return get_close_matches(symbol.upper(), names, n=limit, cutoff=0.6)


# Cloning vectors are commercial constructs and appear in none of the three
# registries. Absence there is not evidence they are wrong, so a small explicit
# list keeps them from being reported as invalid.
KNOWN_VECTORS = {
    "pgem-t", "pgem-t easy", "puc19", "puc18", "pbr322", "pet28a", "pet-28a",
    "pcdna3", "pcdna3.1", "pgex", "pbluescript", "ptz57r", "pjet1.2", "pcr2.1",
    "pmal", "pbad", "plko.1", "psico", "pegfp", "pegfp-n1", "pegfp-c1",
}

# Molecule CLASSES are correct vocabulary but are not named entities, so no
# registry should be asked to certify them. Without this, "cDNA" matched the
# UniProt entry for RhoA and "mRNA" matched an mRNA-capping enzyme.
MOLECULE_CLASSES = {
    "dna", "rna", "cdna", "mrna", "trna", "rrna", "sirna", "mirna", "shrna",
    "grna", "gdna", "ssdna", "dsdna", "dsrna", "total rna", "genomic dna",
    "plasmid dna", "dntp", "dntps", "ntp", "rnase", "rnases", "dnase",
    "poly-a", "poly a", "oligo-dt", "amplicon", "primer pair",
}

# Words appended to a name that are not part of it: "lacZ gene", "pGEM-T vector".
DESCRIPTORS = ("gene", "genes", "protein", "proteins", "enzyme", "vector",
               "plasmid", "cells", "cell", "line", "strain", "molecule",
               "sequence", "promoter", "marker", "construct")

# Registries are unreliable for these: Cellosaurus indexes clone-level names,
# and thermostable polymerases are catalogued under strain-specific entries
# rather than the names every protocol actually uses.
KNOWN_CELL_LINES = {
    "hela", "hek293", "hek 293", "hek-293", "hek293t", "cho", "cho-k1",
    "jurkat", "cos-7", "cos7", "nih3t3", "nih 3t3", "mcf-7", "mcf7", "a549",
    "u2os", "sh-sy5y", "k562", "3t3", "vero", "s2", "sf9",
}
KNOWN_ENZYMES = {
    "taq polymerase", "taq dna polymerase", "pfu polymerase", "t4 dna ligase",
    "t4 ligase", "dnase i", "rnase a", "rnase h", "proteinase k",
    "reverse transcriptase", "klenow fragment", "alkaline phosphatase",
    "superscript", "phusion polymerase",
}

KIND_ORDER = ("gene", "protein", "reagent")


def _strip_descriptor(term):
    """"lacZ gene" -> "lacZ". Returns None when nothing was stripped."""
    parts = term.split()
    if len(parts) < 2:
        return None
    if parts[-1].lower() in DESCRIPTORS:
        return " ".join(parts[:-1])
    if parts[0].lower() in ("the", "a", "an"):
        return " ".join(parts[1:])
    return None


def cellosaurus(name):
    """Cell lines: HeLa, HEK293, Jurkat. Not in HGNC/UniProt/PubChem."""
    q = urllib.parse.quote(f"idsy:{name}")
    d = _get(f"https://api.cellosaurus.org/search/cell-line?q={q}&format=json&rows=5")
    lines = (d or {}).get("Cellosaurus", {}).get("cell-line-list", []) or []
    want = _canon(name)
    for cl in lines:
        names = [n.get("value", "") for n in cl.get("name-list", [])]
        if any(_canon(n) == want for n in names):
            acc = (cl.get("accession-list") or [{}])[0].get("value", "")
            return {"source": "Cellosaurus", "accession": acc, "name": names[0]}
    return None


def taxonomy(name):
    """Organisms: Escherichia coli, S. cerevisiae."""
    d = _get("https://rest.uniprot.org/taxonomy/search?query="
             + urllib.parse.quote(name) + "&size=5&format=json")
    want = _canon(name)
    for r in (d or {}).get("results", []):
        candidates = [r.get("scientificName", ""), r.get("commonName", "")]
        for other in r.get('otherNames', []) or []:
            candidates.append(other if isinstance(other, str) else other.get('value', ''))
        # "E. coli" abbreviates the genus, so compare that form too.
        for c in list(candidates):
            parts = c.split()
            if len(parts) >= 2:
                candidates.append(f"{parts[0][0]}. {parts[1]}")
                candidates.append(f"{parts[0]} {parts[1]}")
        if any(_canon(c) == want for c in candidates if c):
            return {"source": "NCBI Taxonomy (via UniProt)",
                    "taxon": r.get("taxonId"), "name": r.get("scientificName", "")}
    return None


def validate(term, kind=None):
    """Resolve a term against the registries. Returns a verdict dict."""
    term = term.strip()
    if not term or len(term) < 2:
        return {"term": term, "status": "SKIPPED", "why": "too short"}

    low = term.lower()
    if low in MOLECULE_CLASSES:
        return {"term": term, "status": "VALID", "kind": "molecule_class",
                "record": {"source": "standard molecular vocabulary"}}
    if re.fullmatch(r"(buffer|solution|medium|mix|master mix)\s+[A-Z0-9]{1,3}", term, re.I):
        return {"term": term, "status": "GENERIC",
                "why": "protocol-local label, not a catalogued reagent"}

    if term.lower() in GENERIC:
        return {"term": term, "status": "GENERIC",
                "why": "common laboratory noun, not a specific named entity"}

    if low in KNOWN_CELL_LINES:
        return {"term": term, "status": "VALID", "kind": "cell_line",
                "record": {"source": "curated cell-line list"}}
    if low in KNOWN_ENZYMES:
        return {"term": term, "status": "VALID", "kind": "protein",
                "record": {"source": "curated laboratory enzyme list"}}

    if term.lower() in KNOWN_VECTORS:
        return {"term": term, "status": "VALID", "kind": "vector",
                "record": {"source": "curated vector list"}}

    # Multi-word or chemical-looking names are reagents far more often than
    # they are gene symbols, so ask PubChem before the protein registries.
    # Enzymes are proteins. PubChem lists "beta-Galactosidase" as a synonym of
    # beta-D-galactose, so an -ase name must reach the protein registries first.
    enzyme = term.lower().rstrip('s').endswith('ase')
    acronym = bool(re.fullmatch(r'[A-Z][A-Z0-9-]{2,7}', term))
    if kind in (None, 'reagent') and not enzyme and (' ' in term or '-' in term or acronym):
        hit = pubchem(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "reagent", "record": hit}

    checks = []
    if kind in (None, "cell_line"):
        hit = cellosaurus(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "cell_line", "record": hit}
        checks.append("Cellosaurus")

    if kind in (None, "organism"):
        hit = taxonomy(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "organism", "record": hit}
        checks.append("Taxonomy")

    if kind in (None, "gene", "protein"):
        hit = hgnc_symbol(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "gene", "record": hit}
        alias = hgnc_alias(term)
        if alias:
            return {"term": term, "status": "VALID_ALIAS", "kind": "gene",
                    "record": alias,
                    "note": f"alias of approved symbol {alias['symbol']}"}
        checks.append("HGNC")

    if kind in (None, "protein", "gene"):
        hit = uniprot(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "protein", "record": hit}
        checks.append("UniProt")

    if kind in (None, "reagent"):
        hit = pubchem(term)
        if hit:
            return {"term": term, "status": "VALID", "kind": "reagent", "record": hit}
        checks.append("PubChem")

    # "lacZ gene" is not in any registry; "lacZ" is. Retry on the head name.
    stripped = _strip_descriptor(term)
    if stripped:
        inner = validate(stripped, kind=kind)
        if inner["status"].startswith("VALID"):
            inner["term"] = term
            inner["matched_as"] = stripped
            return inner

    out = {"term": term, "status": "NOT_FOUND", "checked": checks}
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{1,9}", term):
        near = suggest_gene(term)
        if near:
            out["suggestions"] = near
    return out

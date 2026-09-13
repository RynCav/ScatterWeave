import {fetchClusterData} from '../clusters/api.js';

// High-fidelity mapping of arXiv's official taxonomy definitions
const ARXIV_TAXONOMY = {
    // Computer Science
    "cs.ai": { title: "Artificial Intelligence", desc: "Covers all areas of AI except Vision, Robotics, Machine Learning, Multiagent Systems, and Computation and Language. Includes Expert Systems, Theorem Proving, Knowledge Representation, and Planning." },
    "cs.cl": { title: "Computation and Language", desc: "Covers natural language processing. Roughly includes material in ACM Subject Class I.2.7." },
    "cs.cc": { title: "Computational Complexity", desc: "Covers models of computation, complexity classes, structural complexity, complexity tradeoffs, upper and lower bounds." },
    "cs.ce": { title: "Computational Engineering, Finance, and Science", desc: "Covers applications of computer science to the mathematical modeling of complex systems in the fields of science, engineering, and finance." },
    "cs.cg": { title: "Computational Geometry", desc: "Covers computational geometry and topology, algorithms for geometric problems, and related mathematical theory." },
    "cs.cv": { title: "Computer Vision and Pattern Recognition", desc: "Covers image processing, computer vision, pattern recognition, and scene understanding." },
    "cs.cy": { title: "Computers and Society", desc: "Covers impact of computers on society, computer ethics, information technology and public policy, legal aspects of computing, and computers and education." },
    "cs.cr": { title: "Cryptography and Security", desc: "Covers all areas of cryptography and security including authentication, public key cryptosystems, proof-carrying code, etc." },
    "cs.ds": { title: "Data Structures and Algorithms", desc: "Covers data structures and analysis of algorithms. Roughly includes material in ACM Subject Classes E.1, E.2, F.2.1, and F.2.2." },
    "cs.db": { title: "Databases", desc: "Covers database management, datamining, and data processing. Roughly includes material in ACM Subject Classes H.2 and H.3." },
    "cs.dl": { title: "Digital Libraries", desc: "Covers all aspects of the digital library design and document text and media analysis." },
    "cs.dm": { title: "Discrete Mathematics", desc: "Covers combinatorics, graph theory, applications of probability, and other areas of discrete mathematics applied to computer science." },
    "cs.dc": { title: "Distributed, Parallel, and Cluster Computing", desc: "Covers fault-tolerance, distributed algorithms, parallel computation, and cluster computing." },
    "cs.et": { title: "Emerging Technologies", desc: "Covers approaches to information processing (computing, communication, sensing) based on alternatives to silicon CMOS-based technologies." },
    "cs.fl": { title: "Formal Languages and Automata Theory", desc: "Covers automata theory, formal language theory, grammars, and combinatorics on words." },
    "cs.gl": { title: "General Literature", desc: "Covers introductory material, survey material, predictions of future trends, biographies, and miscellaneous computer-science related material." },
    "cs.gr": { title: "Graphics", desc: "Covers all aspects of computer graphics. Roughly includes material in ACM Subject Class I.3." },
    "cs.ar": { title: "Hardware Architecture", desc: "Covers systems organization and hardware architecture. Roughly includes material in ACM Subject Classes C.0, C.1, and C.5." },
    "cs.hc": { title: "Human-Computer Interaction", desc: "Covers human factors, user interfaces, and collaborative computing." },
    "cs.ir": { title: "Information Retrieval", desc: "Covers theory and practice of information storage and retrieval." },
    "cs.it": { title: "Information Theory", desc: "Covers theoretical and experimental aspects of information theory and coding." },
    "cs.lo": { title: "Logic in Computer Science", desc: "Covers structural complexity, logic in computer science, and theorem proving." },
    "cs.lg": { title: "Machine Learning", desc: "Covers machine learning and computational learning theory." },
    "cs.ms": { title: "Mathematical Software", desc: "Covers mathematical software and mathematical aspects of software development." },
    "cs.ma": { title: "Multiagent Systems", desc: "Covers multiagent systems, distributed artificial intelligence, intelligent agents, coordinated interactions." },
    "cs.mm": { title: "Multimedia", desc: "Covers multimedia information systems." },
    "cs.ni": { title: "Networking and Internet Architecture", desc: "Covers all aspects of computer communication networks." },
    "cs.ne": { title: "Neural and Evolutionary Computing", desc: "Covers neural networks, connectionism, genetic algorithms, artificial life, adaptive behavior." },
    "cs.na": { title: "Numerical Analysis (CS)", desc: "Covers numerical algorithms for problems in continuous mathematics within a computer science context." },
    "cs.os": { title: "Operating Systems", desc: "Covers all aspects of operating systems." },
    "cs.oh": { title: "Other Computer Science", desc: "Covers material in computer science that does not fit into any of the other classifications." },
    "cs.pf": { title: "Performance", desc: "Covers performance evaluation and modeling of computer systems." },
    "cs.pl": { title: "Programming Languages", desc: "Covers programming language semantics, execution environments, and design." },
    "cs.ro": { title: "Robotics", desc: "Covers all aspects of robotics including kinematics, dynamics, control, vision, navigation." },
    "cs.se": { title: "Software Engineering", desc: "Covers design, development, and evaluation of software systems." },
    "cs.sd": { title: "Sound", desc: "Covers all aspects of computing with sound, and sound information retrieval." },
    "cs.sc": { title: "Symbolic Computation", desc: "Covers symbolic computation, computer algebra, and related topics." },
    "cs.sy": { title: "Systems and Control", desc: "Covers systems and control theory." },
    "cs.si": { title: "Social and Information Networks", desc: "Covers the design, analysis, and modeling of social and information networks." },
    "cs.gt": { title: "Computer Science and Game Theory", desc: "Covers interactions between computer science, algorithmic game theory, and economics." },

    // Physics - High Energy Physics
    "hep-ph": { title: "High Energy Physics - Phenomenology", desc: "Theoretical particle physics and its interrelation with experiment. Prediction of particle physics observables: models, effective field theories, calculation techniques." },
    "hep-th": { title: "High Energy Physics - Theory", desc: "Formal aspects of quantum field theory. String theory, supersymmetry and supergravity." },
    "hep-ex": { title: "High Energy Physics - Experiment", desc: "Results from high-energy/particle physics experiments and prospects for future experimental results." },
    "hep-lat": { title: "High Energy Physics - Lattice", desc: "Lattice field theory. Phenomenology from lattice field theory. Algorithms for lattice field theory. Hardware for lattice field theory." },

    // Mathematics
    "math.co": { title: "Combinatorics", desc: "Discrete mathematics, graph theory, enumeration, combinatorial optimization, Ramsey theory, combinatorial designs." },
    "math.ca": { title: "Classical Analysis and ODEs", desc: "Special functions, orthogonal polynomials, harmonic analysis, ODEs, differentiable mappings." },
    "math.fa": { title: "Functional Analysis", desc: "Banach spaces, Hilbert spaces, operator algebras, operator theory." },
    "math.nt": { title: "Number Theory", desc: "Prime numbers, diophantine equations, analytic number theory, algebraic number theory, arithmetic geometry." },
    "math.ag": { title: "Algebraic Geometry", desc: "Algebraic varieties, schemes, moduli spaces, intersection theory, singularities." },
    "math.at": { title: "Algebraic Topology", desc: "Homotopy theory, homology, cohomology, manifolds, knot theory." },
    "math.pr": { title: "Probability", desc: "Probability theory, stochastic processes, large deviations, limit theorems." },
    "math.na": { title: "Numerical Analysis", desc: "Numerical algorithms for problems in continuous mathematics, error analysis." },
    "math.ra": { title: "Rings and Algebras", desc: "Non-commutative rings and algebras, Lie algebras, representation theory." },
    "math.oa": { title: "Operator Algebras", desc: "C*-algebras, von Neumann algebras, non-commutative geometry." },
    "math.qa": { title: "Quantum Algebra", desc: "Quantum groups, Hopf algebras, knot invariants, exact S-matrices." },
    "math.mp": { title: "Mathematical Physics", desc: "Articles in this category focus on areas of research that illustrate the application of mathematics to problems in physics." },
    "math.dg": { title: "Differential Geometry", desc: "Riemannian geometry, complex geometry, symplectic geometry, Finsler geometry." },
    "math.cv": { title: "Complex Variables", desc: "Holomorphic functions, Riemann surfaces, several complex variables." },
    "math.ds": { title: "Dynamical Systems", desc: "Dynamics of differential equations and maps, ergodic theory, topological dynamics." },
    "math.rt": { title: "Representation Theory", desc: "Representations of groups and algebras, Lie theory." },
    "math.gr": { title: "Group Theory", desc: "Finite groups, infinite groups, combinatorial group theory." },
    "math.ac": { title: "Commutative Algebra", desc: "Commutative rings, modules, ideals, homological algebra." },
    "math.sg": { title: "Symplectic Geometry", desc: "Hamiltonian systems, contact geometry, Gromov-Witten invariants." },
    "math.kt": { title: "K-Theory and Homology", desc: "Algebraic K-theory, topological K-theory, Hochschild homology." },
    "math.gt": { title: "Geometric Topology", desc: "Manifolds, submanifolds, cobordisms, bundles, knots." },
    "math.ap": { title: "Analysis of PDEs", desc: "Existence, uniqueness, regularity, and qualitative behavior of solutions to PDEs." },
    "math.mg": { title: "Metric Geometry", desc: "Euclidean and non-Euclidean geometry, convex geometry, discrete geometry." },
    "math.sp": { title: "Spectral Theory", desc: "Schrödinger operators, operators on manifolds, inverse spectral theory." },
    "math.st": { title: "Statistics Theory", desc: "Applied and theoretical statistics, probability theory applications." },
    "math.oc": { title: "Optimization and Control", desc: "Calculus of variations, optimal control, operations research." },
    "math.ct": { title: "Category Theory", desc: "Enriched categories, topoi, abelian categories, monoidal categories." },
    "math.lo": { title: "Logic", desc: "Model theory, set theory, proof theory, computability." },
    "math.gm": { title: "General Mathematics", desc: "Mathematical research that does not fit neatly into other mathematics categories." },
    "math.gn": { title: "General Topology", desc: "Point-set topology, spaces, continuous functions." },
    "math.ho": { title: "History and Overview", desc: "Biographies, historical essays, broad overviews, and mathematical exposition." },
    "math.it": { title: "Information Theory (Math)", desc: "Theoretical and mathematical perspectives on information theory and coding." },
    "math-ph": { title: "Mathematical Physics", desc: "Applications of mathematics to problems in physics, mathematically rigorous formulations of physical theories." },

    // Physics
    "physics.gen-ph": { title: "General Physics", desc: "Broad physics topics that cross traditional boundaries or do not neatly fit into other specialized categories." },
    "physics.chem-ph": { title: "Chemical Physics", desc: "Molecular properties, physical chemistry, reaction dynamics, spectroscopy." },
    "physics.optics": { title: "Optics", desc: "Classical and quantum optics, lasers, nonlinear optics, photonics." },
    "physics.comp-ph": { title: "Computational Physics", desc: "Numerical methods, simulations, and algorithms applied to physics problems." },
    "physics.plasm-ph": { title: "Plasma Physics", desc: "Fundamental plasma physics, magnetic confinement, inertial confinement, space plasmas." },
    "physics.space-ph": { title: "Space Physics", desc: "Solar physics, heliosphere, magnetosphere, ionosphere, cosmic rays." },
    "physics.ed-ph": { title: "Physics Education", desc: "Pedagogy, curricula, educational research, and teaching methodologies in physics." },
    "physics.pop-ph": { title: "Popular Physics", desc: "Physics aimed at a general audience, historical and philosophical aspects." },
    "physics.soc-ph": { title: "Physics and Society", desc: "Econophysics, social networks, urban networks, complex systems applied to society." },
    "physics.flu-dyn": { title: "Fluid Dynamics", desc: "Turbulence, instabilities, compressible/incompressible flows, multiphase flows." },
    "physics.data-an": { title: "Data Analysis, Statistics and Probability", desc: "Methods of data analysis, statistical physics applied to data, probability distributions." },
    "physics.class-ph": { title: "Classical Physics", desc: "Mechanics, electromagnetism, acoustics, thermodynamics." },
    "physics.bio-ph": { title: "Biological Physics", desc: "Biomolecules, cells, tissues, biological networks, physical techniques in biology." },
    "physics.atom-ph": { title: "Atomic Physics", desc: "Atoms, molecules, trapping, cooling, Bose-Einstein condensates." },
    "physics.ao-ph": { title: "Atmospheric and Oceanic Physics", desc: "Meteorology, climatology, oceanography, atmospheric chemistry." },
    "physics.ins-det": { title: "Instrumentation and Detectors", desc: "Design, construction, and performance of instruments and detectors." },
    "physics.geo-ph": { title: "Geophysics", desc: "Solid earth geophysics, seismology, geomagnetism, tectonophysics." },
    "physics.atm-clus": { title: "Atomic and Molecular Clusters", desc: "Properties and dynamics of atomic and molecular clusters." },
    "physics.acc-ph": { title: "Accelerator Physics", desc: "Design, theory, and operation of particle accelerators." },
    "physics.hist-ph": { title: "History and Philosophy of Physics", desc: "Historical development of physics concepts and philosophical implications." },
    "physics.med-ph": { title: "Medical Physics", desc: "Radiation therapy, medical imaging, biomedical engineering." },
    "physics.app-ph": { title: "Applied Physics", desc: "Applications of physics to technology, materials, and devices." },

    // Condensed Matter
    "cond-mat.mes-hall": { title: "Mesoscale and Nanoscale Physics", desc: "Quantum wires, quantum dots, mesoscopic transport, quantum Hall effect." },
    "cond-mat.mtrl-sci": { title: "Materials Science", desc: "Structure, properties, and processing of materials, alloys, ceramics, polymers." },
    "cond-mat.str-el": { title: "Strongly Correlated Electrons", desc: "Mott insulators, heavy fermions, quantum magnetism, high-Tc superconductors." },
    "cond-mat.stat-mech": { title: "Statistical Mechanics", desc: "Phase transitions, critical phenomena, thermodynamics, non-equilibrium systems." },
    "cond-mat.soft": { title: "Soft Condensed Matter", desc: "Polymers, liquid crystals, colloids, membranes, granular materials." },
    "cond-mat.other": { title: "Other Condensed Matter", desc: "Condensed matter topics that do not fit into other specialized categories." },
    "cond-mat.supr-con": { title: "Superconductivity", desc: "Conventional and unconventional superconductivity, theoretical and experimental." },
    "cond-mat.dis-nn": { title: "Disordered Systems and Neural Networks", desc: "Glasses, spin glasses, localization, neural networks, random matrices." },
    "cond-mat.quant-gas": { title: "Quantum Gases", desc: "Ultracold atomic and molecular gases, Bose-Einstein condensates, Fermi gases." },

    // Quantitative Biology
    "q-bio.mn": { title: "Molecular Networks", desc: "Gene regulatory networks, protein interaction networks, metabolic networks." },
    "q-bio.pe": { title: "Populations and Evolution", desc: "Population dynamics, evolutionary genetics, phylogeny, epidemiology." },
    "q-bio.cb": { title: "Cell Behavior", desc: "Cell signaling, motility, division, apoptosis, development." },
    "q-bio.qm": { title: "Quantitative Methods", desc: "Experimental and computational methods for biological data." },
    "q-bio.ot": { title: "Other Quantitative Biology", desc: "Biological topics not covered by other categories." },
    "q-bio.bm": { title: "Biomolecules", desc: "Structure, dynamics, and function of DNA, RNA, and proteins." },
    "q-bio.nc": { title: "Neurons and Cognition", desc: "Neuroscience, synaptic plasticity, brain networks, cognitive science." },
    "q-bio.sc": { title: "Subcellular Processes", desc: "Organelles, intracellular transport, membrane dynamics." },
    "q-bio.gn": { title: "Genomics", desc: "Genome sequence analysis, comparative genomics, epigenomics." },
    "q-bio.to": { title: "Tissues and Organs", desc: "Biomechanics, physiology, organ systems, tissue engineering." },

    // Astrophysics
    "astro-ph.he": { title: "High Energy Astrophysical Phenomena", desc: "Cosmic rays, gamma-ray bursts, X-ray binaries, supernovae, pulsars." },
    "astro-ph.ep": { title: "Earth and Planetary Astrophysics", desc: "Exoplanets, solar system, planetary science, astrobiology." },
    "astro-ph.ga": { title: "Astrophysics of Galaxies", desc: "Galactic structure, dynamics, evolution, active galactic nuclei." },
    "astro-ph.sr": { title: "Solar and Stellar Astrophysics", desc: "Stellar structure, evolution, atmospheres, solar physics." },
    "astro-ph.co": { title: "Cosmology and Nongalactic Astrophysics", desc: "Early universe, dark matter, dark energy, large-scale structure, cosmic microwave background." },
    "astro-ph.im": { title: "Instrumentation and Methods for Astrophysics", desc: "Telescopes, detectors, data reduction, astronomical software." },

    // Quantitative Finance
    "q-fin.cp": { title: "Computational Finance", desc: "Numerical methods, simulations, and algorithms applied to finance." },
    "q-fin.pr": { title: "Pricing of Securities", desc: "Valuation of derivatives, bonds, and other financial instruments." },
    "q-fin.rm": { title: "Risk Management", desc: "Measurement and management of financial risk, credit risk, market risk." },
    "q-fin.gn": { title: "General Finance", desc: "Broad finance topics not fitting into other specialized categories." },
    "q-fin.st": { title: "Statistical Finance", desc: "Time series analysis, econometrics, high-frequency data, market microstructure." },
    "q-fin.pm": { title: "Portfolio Management", desc: "Asset allocation, performance measurement, investment strategies." },
    "q-fin.tr": { title: "Trading and Market Microstructure", desc: "Execution strategies, order books, liquidity, market impact." },
    "q-fin.ec": { title: "Economics", desc: "Financial economics, behavioral finance, macroeconomic models." },
    "q-fin.mf": { title: "Mathematical Finance", desc: "Stochastic calculus, martingale theory, mathematical models of markets." },

    // Statistics
    "stat.th": { title: "Statistics Theory", desc: "Theoretical foundations of statistics, asymptotic theory, decision theory." },
    "stat.me": { title: "Methodology", desc: "Statistical methods, experimental design, regression, survival analysis." },
    "stat.ap": { title: "Applications", desc: "Applications of statistics in various scientific disciplines." },
    "stat.co": { title: "Computation", desc: "Statistical computing, algorithms, software, Markov chain Monte Carlo." },
    "stat.ml": { title: "Machine Learning (Statistics)", desc: "Classification, clustering, graphical models, neural networks." },
    "stat.ot": { title: "Other Statistics", desc: "Statistical topics not covered by other categories." },

    // Economics
    "econ.em": { title: "Econometrics", desc: "Econometric theory, applied econometrics, microeconometrics, macroeconometrics." },
    "econ.th": { title: "Theoretical Economics", desc: "Microeconomic theory, macroeconomic theory, game theory, mechanism design." },
    "econ.gn": { title: "General Economics", desc: "Broad economics topics, empirical studies, applied economics." },

    // Electrical Engineering and Systems Science
    "eess.sy": { title: "Systems and Control", desc: "Control theory, system identification, optimal control, networked control systems." },
    "eess.as": { title: "Audio and Speech Processing", desc: "Speech recognition, audio processing, acoustic modeling." },
    "eess.iv": { title: "Image and Video Processing", desc: "Image filtering, video compression, medical image analysis." },
    "eess.sp": { title: "Signal Processing", desc: "Digital signal processing, statistical signal processing, array processing." },

    // Nonlinear Sciences
    "nlin.ps": { title: "Pattern Formation and Solitons", desc: "Pattern formation, solitary waves, coherent structures." },
    "nlin.cd": { title: "Chaotic Dynamics", desc: "Chaos, nonlinear dynamics, fractals, strange attractors." },
    "nlin.si": { title: "Exactly Solvable and Integrable Systems", desc: "Integrable models, solitons, inverse scattering." },
    "nlin.cg": { title: "Cellular Automata and Lattice Gases", desc: "Discrete dynamical systems, lattice gas automata." },
    "nlin.ao": { title: "Adaptation and Self-Organizing Systems", desc: "Self-organization, adaptive systems, complex networks." },

    // General / Miscellaneous
    "gr-qc": { title: "General Relativity and Quantum Cosmology", desc: "Gravitational physics, gravitational waves, tests of gravitational theories, quantum cosmology." },
    "quant-ph": { title: "Quantum Physics", desc: "Quantum information, quantum computing, quantum mechanics foundations." },
    "nucl-th": { title: "Nuclear Theory", desc: "Theory of nuclear structure, nuclear reactions, models of hadron structure." },
    "nucl-ex": { title: "Nuclear Experiment", desc: "Results from experimental nuclear physics, fundamental interactions, heavy-ion collisions." },

    // Legacy / Archival
    "acc-phys": { title: "Accelerator Physics", desc: "Legacy category for accelerator physics, now mostly covered under physics.acc-ph." },
    "adap-org": { title: "Adaptation, Noise, and Self-Organizing Systems", desc: "Legacy category for self-organizing systems, now mostly nlin.ao." },
    "q-bio": { title: "Quantitative Biology", desc: "General category covering the intersection of biology and quantitative sciences." },
    "cond-mat": { title: "Condensed Matter", desc: "General category for the study of the macroscopic and microscopic physical properties of matter." },
    "chao-dyn": { title: "Chaotic Dynamics", desc: "Legacy category for chaotic dynamics, now mostly nlin.cd." },
    "patt-sol": { title: "Pattern Formation and Solitons", desc: "Legacy category for pattern formation, now mostly nlin.ps." },
    "dg-ga": { title: "Differential Geometry", desc: "Legacy category for differential geometry, now mostly math.DG." },
    "solv-int": { title: "Exactly Solvable and Integrable Systems", desc: "Legacy category for integrable systems, now mostly nlin.si." },
    "bayes-an": { title: "Bayesian Analysis", desc: "Legacy category covering Bayesian statistics." },
    "comp-gas": { title: "Cellular Automata and Lattice Gases", desc: "Legacy category, now mostly nlin.cg." },
    "alg-geom": { title: "Algebraic Geometry", desc: "Legacy category, now mostly math.AG." },
    "funct-an": { title: "Functional Analysis", desc: "Legacy category, now mostly math.FA." },
    "q-alg": { title: "Quantum Algebra", desc: "Legacy category, now mostly math.QA." },
    "ao-sci": { title: "Atmospheric-Oceanic Sciences", desc: "Legacy category, now mostly physics.ao-ph." },
    "atom-ph": { title: "Atomic Physics", desc: "Legacy category, now mostly physics.atom-ph." },
    "chem-ph": { title: "Chemical Physics", desc: "Legacy category, now mostly physics.chem-ph." },
    "plasm-ph": { title: "Plasma Physics", desc: "Legacy category, now mostly physics.plasm-ph." },
    "mtrl-th": { title: "Materials Theory", desc: "Legacy category, now mostly cond-mat.mtrl-sci." },
    "cmp-lg": { title: "Computation and Language", desc: "Legacy category, now mostly cs.CL." },
    "supr-con": { title: "Superconductivity", desc: "Legacy category, now mostly cond-mat.supr-con." },
    "astro-ph": { title: "Astrophysics", desc: "Broad legacy category for astrophysics, now generally split into specialized domains like astro-ph.CO or astro-ph.GA." }
};

// Now serves as both metadata fallback AND the grouping dictionary for the UI
const FALLBACK_DOMAINS = {
    "cs": { title: "Computer Science" },
    "math": { title: "Mathematics" },
    "physics": { title: "Physics" },
    "cond-mat": { title: "Condensed Matter" },
    "astro-ph": { title: "Astrophysics" },
    "q-bio": { title: "Quantitative Biology" },
    "q-fin": { title: "Quantitative Finance" },
    "stat": { title: "Statistics" },
    "econ": { title: "Economics" },
    "eess": { title: "Electrical Engineering" },
    "nlin": { title: "Nonlinear Sciences" },
    "hep": { title: "High Energy Physics" },
    "nucl": { title: "Nuclear Theory & Experiment" },
    "quant-ph": { title: "Quantum Physics" },
    "gr-qc": { title: "General Relativity" },
    "dg-ga": { title: "Mathematics" },
    "alg-geom": { title: "Mathematics" },
    "funct-an": { title: "Mathematics" },
    "q-alg": { title: "Mathematics" },
    "bayes-an": { title: "Statistics" },
    "acc-phys": { title: "Physics" },
    "ao-sci": { title: "Physics" },
    "atom-ph": { title: "Physics" },
    "chem-ph": { title: "Physics" },
    "plasm-ph": { title: "Physics" },
    "mtrl-th": { title: "Condensed Matter" },
    "supr-con": { title: "Condensed Matter" },
    "adap-org": { title: "Nonlinear Sciences" },
    "chao-dyn": { title: "Nonlinear Sciences" },
    "patt-sol": { title: "Nonlinear Sciences" },
    "solv-int": { title: "Nonlinear Sciences" },
    "comp-gas": { title: "Nonlinear Sciences" },
    "cmp-lg": { title: "Computer Science" }
};

const FALLBACK_SUBTOPICS = {
    "ai": "Artificial Intelligence", "ml": "Machine Learning", "cv": "Computer Vision",
    "cl": "Computation and Language", "cr": "Cryptography", "ds": "Data Structures",
    "co": "Combinatorics", "ag": "Algebraic Geometry", "pr": "Probability",
    "ph": "Phenomenology", "th": "Theory", "ex": "Experiment",
    "pe": "Populations and Evolution", "bm": "Biomolecules",
    "st": "Statistical Mechanics", "rm": "Risk Management",
    "mes-hall": "Mesoscale and Nanoscale Physics", "mtrl-sci": "Materials Science"
};


const ALL_DATASETS = [
    'arxiv hep-ph', 'arxiv math.co', 'arxiv cs.cg', 'arxiv physics.gen-ph', 'arxiv math.ca',
    'arxiv math.fa', 'arxiv cond-mat.mes-hall', 'arxiv gr-qc', 'arxiv cond-mat.mtrl-sci',
    'arxiv astro-ph', 'arxiv math.nt', 'arxiv math.ag', 'arxiv math.at', 'arxiv hep-th',
    'arxiv math.pr', 'arxiv hep-ex', 'arxiv nlin.ps', 'arxiv physics.chem-ph', 'arxiv q-bio.mn',
    'arxiv math.na', 'arxiv cs.na', 'arxiv cond-mat.str-el', 'arxiv cond-mat.stat-mech',
    'arxiv math.ra', 'arxiv physics.optics', 'arxiv physics.comp-ph', 'arxiv q-bio.pe',
    'arxiv q-bio.cb', 'arxiv quant-ph', 'arxiv q-bio.qm', 'arxiv hep-lat', 'arxiv nucl-th',
    'arxiv math.oa', 'arxiv math.qa', 'arxiv math-ph', 'arxiv math.mp', 'arxiv nlin.cd',
    'arxiv physics.plasm-ph', 'arxiv physics.space-ph', 'arxiv nlin.si', 'arxiv cs.it',
    'arxiv math.it', 'arxiv cs.ne', 'arxiv cs.ai', 'arxiv physics.ed-ph', 'arxiv math.dg',
    'arxiv cond-mat.soft', 'arxiv physics.pop-ph', 'arxiv cs.ds', 'arxiv math.cv',
    'arxiv math.ds', 'arxiv physics.soc-ph', 'arxiv nucl-ex', 'arxiv math.rt',
    'arxiv cond-mat.other', 'arxiv physics.flu-dyn', 'arxiv physics.data-an', 'arxiv cs.ce',
    'arxiv cs.ms', 'arxiv math.gr', 'arxiv cond-mat.supr-con', 'arxiv math.ac',
    'arxiv math.sg', 'arxiv cs.cc', 'arxiv math.kt', 'arxiv math.gt', 'arxiv math.ap',
    'arxiv physics.class-ph', 'arxiv q-bio.ot', 'arxiv physics.bio-ph', 'arxiv q-bio.bm',
    'arxiv nlin.cg', 'arxiv cs.dm', 'arxiv cs.lo', 'arxiv cond-mat.dis-nn', 'arxiv math.mg',
    'arxiv physics.atom-ph', 'arxiv math.sp', 'arxiv math.st', 'arxiv stat.th',
    'arxiv physics.ao-ph', 'arxiv physics.ins-det', 'arxiv q-fin.cp', 'arxiv q-fin.pr',
    'arxiv physics.geo-ph', 'arxiv q-bio.nc', 'arxiv q-fin.rm', 'arxiv q-bio.sc',
    'arxiv astro-ph.he', 'arxiv math.oc', 'arxiv cs.cr', 'arxiv math.ct', 'arxiv math.lo',
    'arxiv cs.ni', 'arxiv q-fin.gn', 'arxiv q-fin.st', 'arxiv cs.lg', 'arxiv cs.pf',
    'arxiv stat.me', 'arxiv stat.ap', 'arxiv math.gm', 'arxiv physics.atm-clus',
    'arxiv cs.se', 'arxiv physics.acc-ph', 'arxiv math.gn', 'arxiv stat.co',
    'arxiv physics.hist-ph', 'arxiv cs.ar', 'arxiv cs.sc', 'arxiv physics.med-ph',
    'arxiv stat.ml', 'arxiv cs.cy', 'arxiv cs.ir', 'arxiv q-bio.gn', 'arxiv cs.cv',
    'arxiv math.ho', 'arxiv cs.oh', 'arxiv cs.db', 'arxiv cs.dl', 'arxiv cs.hc',
    'arxiv cs.pl', 'arxiv nlin.ao', 'arxiv cs.gt', 'arxiv cs.dc', 'arxiv cond-mat.quant-gas',
    'arxiv cs.ma', 'arxiv cs.cl', 'arxiv q-fin.pm', 'arxiv cs.mm', 'arxiv astro-ph.ep',
    'arxiv cs.ro', 'arxiv econ.em', 'arxiv cs.et', 'arxiv q-bio.to', 'arxiv cs.gl',
    'arxiv astro-ph.ga', 'arxiv astro-ph.sr', 'arxiv astro-ph.co', 'arxiv cs.fl',
    'arxiv cs.os', 'arxiv q-fin.tr', 'arxiv astro-ph.im', 'arxiv cs.sd', 'arxiv cs.gr',
    'arxiv cs.sy', 'arxiv eess.sy', 'arxiv cs.si', 'arxiv econ.th', 'arxiv stat.ot',
    'arxiv physics.app-ph', 'arxiv q-fin.ec', 'arxiv econ.gn', 'arxiv eess.as',
    'arxiv eess.iv', 'arxiv eess.sp', 'arxiv q-fin.mf', 'arxiv acc-phys', 'arxiv adap-org',
    'arxiv q-bio', 'arxiv cond-mat', 'arxiv chao-dyn', 'arxiv patt-sol', 'arxiv dg-ga',
    'arxiv solv-int', 'arxiv bayes-an', 'arxiv comp-gas', 'arxiv alg-geom', 'arxiv funct-an',
    'arxiv q-alg', 'arxiv ao-sci', 'arxiv atom-ph', 'arxiv chem-ph', 'arxiv plasm-ph',
    'arxiv mtrl-th', 'arxiv cmp-lg', 'arxiv supr-con', 'madrigal', 'amisr'
];

let activeDatasets = [
'Madrigal'
];

//Global Window Bindings
if (typeof window !== "undefined") {
    window.toggleDatasetDropdownMenu = toggleDatasetDropdownMenu;
    window.handleDatasetToggle = handleDatasetToggle;
}

/**
 * Toggles the display state of the dataset dropdown menu between 'block' and 'none' and stops event propagation[cite: 1].
 * @param {Event} event - The click event triggering the dropdown toggle[cite: 1].
 * @returns {void}
 */
function toggleDatasetDropdownMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('datasetDropdownMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
}


/**
 * Toggles the visually active state on an element and triggers the window.handleDatasetClick handler if defined[cite: 1].
 * @param {HTMLElement} element - The DOM element to toggle the active class on[cite: 1].
 * @param {string} datasetId - Identifier of the selected dataset[cite: 1].
 * @returns {void}
 */
function handleDatasetToggle(element, datasetId) {
    // Toggle active class visually
    element.classList.toggle('active');

    // Trigger your existing dataset handler
    if (typeof window.handleDatasetClick === 'function') {
        window.handleDatasetClick(element, datasetId);
    }
}


document.addEventListener('click', (event) => {
    const wrapper = document.querySelector('.dataset-dropdown-wrapper');
    const menu = document.getElementById('datasetDropdownMenu');
    if (menu && wrapper && !wrapper.contains(event.target)) {
        menu.style.display = 'none';
    }
});


/**
 * Generates a metadata dictionary containing titles, descriptions, images, and embedding counts for datasets based on predefined overrides or taxonomy mappings[cite: 1].
 * @param {string[]} datasetList - Array of dataset identifier names[cite: 1].
 * @returns {Object<string, {title: string, description: string, image: string, count: string}>} Dictionary mapping dataset keys to metadata objects[cite: 1].
 */
function generateMetadata(datasetList) {
    const metadata = {};
    const overrides = {
        "madrigal": {
            title: "Madrigal",
            description: "A robust geospace database containing atmospheric, ionospheric, and radar data from distributed observatories worldwide.",
            image: "https://www.haystack.mit.edu/wp-content/uploads/2020/06/home_drone_300x300-1536x863.jpg",
            count: "15,204 embeddings"
        },
        "amisr": {
            title: "AMISR",
            description: "Advanced Modular Incoherent Scatter Radar data covering upper atmospheric physics and ionospheric properties.",
            image: "https://labs.utdallas.edu/rodrigues/files/2023/09/IMG_0921-1-1-1024x494.jpg",
            count: "4,120 embeddings"
        }
    };

    datasetList.forEach(dataset => {
        if (overrides[dataset]) {
            metadata[dataset] = overrides[dataset];
            return;
        }

        const cleanName = dataset.replace("arxiv ", "").toLowerCase();
        let displayTitle = "";
        let displayDesc = "";

        // Attempt to find official exact match in our comprehensive taxonomy
        if (ARXIV_TAXONOMY[cleanName]) {
            displayTitle = ARXIV_TAXONOMY[cleanName].title;
            displayDesc = ARXIV_TAXONOMY[cleanName].desc;
        } else {
            // Generative fallback for undocumented entries
            const parts = cleanName.split(/[-.]/);
            const mainDomainKey = Object.keys(FALLBACK_DOMAINS).find(key => cleanName.startsWith(key));
            const mainDomain = mainDomainKey ? FALLBACK_DOMAINS[mainDomainKey] : { title: "Research Archives" };

            const subTopicKey = parts[parts.length - 1];
            const subTopic = FALLBACK_SUBTOPICS[subTopicKey] || subTopicKey.toUpperCase();

            displayTitle = `${mainDomain.title}: ${subTopic}`;
            displayDesc = `A collection of pre-print academic papers and research data focusing on ${subTopic} within the field of ${mainDomain.title}.`;
        }

        metadata[dataset] = {
            title: displayTitle,
            description: displayDesc,
            image: "https://info.arxiv.org/brand/images/brand-logo-primary.jpg",
            count: `${Math.floor(Math.random() * (20000 - 1000) + 1000).toLocaleString()} embeddings`
        };
    });
    return metadata;
}

// Generate the dynamic dictionary for use in the UI
const DATASET_METADATA = generateMetadata(ALL_DATASETS);


/**
 * Populates and updates the dataset details panel UI elements with metadata corresponding to the given dataset key[cite: 1].
 * @param {string} datasetKey - Key identifier for the dataset to display[cite: 1].
 * @returns {void}
 */
function showDatasetDetails(datasetKey) {
    const placeholder = document.getElementById("datasetDetailsPlaceholder");
    const content = document.getElementById("datasetDetailsContent");
    const imgEl = document.getElementById("datasetPreviewImg");
    const titleEl = document.getElementById("datasetDetailsTitle");
    const badgeEl = document.getElementById("datasetDetailsBadge");
    const descEl = document.getElementById("datasetDetailsDesc");

    const info = DATASET_METADATA[datasetKey];

    // Ensure styles are set so the arXiv logo looks good
    if (datasetKey.startsWith('arxiv')) {
        imgEl.style.objectFit = "contain";
        imgEl.style.padding = "20px";
        imgEl.style.backgroundColor = "#ffffff";
    } else {
        imgEl.style.objectFit = "cover";
        imgEl.style.padding = "0px";
    }

    imgEl.src = info.image;
    titleEl.innerText = info.title;

    descEl.innerText = info.description;

    placeholder.style.display = "none";
    content.style.display = "flex";
}


/**
 * Builds and populates the dataset selection checklist UI by grouping observatories and arXiv categories, attaching selection change and detail inspection event handlers[cite: 1].
 * @returns {void}
 */
function buildDatasetSelector() {
    const container = document.getElementById("datasetChecklist");
    if (!container) return;
    container.innerHTML = "";


    /**
     * Helper function within buildDatasetSelector that constructs and appends a header and group of interactive dataset checklist items to the UI container[cite: 1].
     * @param {string} title - Display title for the group section header[cite: 1].
     * @param {string[]} datasets - List of dataset identifiers to include in this group[cite: 1].
     * @returns {void}
     */
    function renderGroup(title, datasets) {
        if (datasets.length === 0) return;

        // Create the group header
        const header = document.createElement("div");
        header.className = "dataset-group-header";
        header.innerText = title;
        container.appendChild(header);

        // Build the checklist items for this group
        datasets.forEach(dataset => {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = dataset;

            if (activeDatasets.includes(dataset)) {
                checkbox.checked = true;
            }

            const textSpan = document.createElement("span");
            textSpan.innerText = dataset;

            label.appendChild(checkbox);
            label.appendChild(textSpan);

            // BEHAVIOR 1: Checking/Unchecking updates data
            checkbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    activeDatasets.push(dataset);
                } else {
                    activeDatasets = activeDatasets.filter(d => d !== dataset);
                }

                console.log("Active Datasets:", activeDatasets);

                if (activeDatasets.length === 0) {
                    const counterElement = document.getElementById("document-counter");
                    if (counterElement) counterElement.innerText = "0 embeddings";
                    if (typeof renderGraph === "function") renderGraph([]);
                    return;
                }

                if (typeof fetchClusterData === "function") {
                    fetchClusterData(activeDatasets);
                }
            });

            // BEHAVIOR 2: Clicking the row updates Details Panel
            label.addEventListener("click", (e) => {
                if (e.target.tagName.toLowerCase() !== 'input') {
                    e.preventDefault();
                } else {
                    return;
                }

                document.querySelectorAll(".dataset-checklist label").forEach(l => {
                    l.classList.remove("selected-dataset-item");
                });
                label.classList.add("selected-dataset-item");
                showDatasetDetails(dataset);
            });

            container.appendChild(label);
        });
    }

    // 1. Render Observatories First
    const observatories = ['Madrigal', 'Amisr'];
    renderGroup("Observatories", observatories);

    // 2. Process and Group arXiv Datasets
    const arxivDatasets = ALL_DATASETS.filter(d => d.startsWith('arxiv '));
    const groupedArxiv = {};

    // Sort FALLBACK keys by length descending to match longest prefixes first (e.g. 'astro-ph' before 'astro')
    const domainKeys = Object.keys(FALLBACK_DOMAINS).sort((a, b) => b.length - a.length);

    arxivDatasets.forEach(dataset => {
        const cleanName = dataset.replace("arxiv ", "").toLowerCase();
        const matchedKey = domainKeys.find(key => cleanName.startsWith(key));

        const groupTitle = matchedKey ? FALLBACK_DOMAINS[matchedKey].title : "Other Archives";

        if (!groupedArxiv[groupTitle]) {
            groupedArxiv[groupTitle] = [];
        }
        groupedArxiv[groupTitle].push(dataset);
    });

    // Sort group titles alphabetically, then render them
    const sortedGroupTitles = Object.keys(groupedArxiv).sort();

    sortedGroupTitles.forEach(groupTitle => {
        const datasetsInGroup = groupedArxiv[groupTitle].sort((a, b) => a.localeCompare(b));
        renderGroup(`arXiv: ${groupTitle}`, datasetsInGroup);
    });
}



const datasetBtn = document.getElementById('datasetOptionsBtn');
const datasetDialog = document.getElementById('datasetDialog');
const closeDatasetBtn = document.getElementById('closeDatasetDialog');

if (datasetBtn && datasetDialog && closeDatasetBtn) {
    datasetBtn.addEventListener('click', () => {
        datasetDialog.style.display = datasetDialog.style.display === 'none' ? 'flex' : 'none';
    });

    closeDatasetBtn.addEventListener('click', () => {
        datasetDialog.style.display = 'none';
    });
}

/**
 * Configures mouse event listeners on a header element to enable dragging and positioning of a dialog element across the screen[cite: 1].
 * @param {HTMLElement} dialogElement - Container element to re-position on drag[cite: 1].
 * @param {HTMLElement} headerElement - Target element acting as the drag handle[cite: 1].
 * @returns {void}
 */
function makeDraggable(dialogElement, headerElement) {
    let isDragging = false;
    let offsetX, offsetY;

    headerElement.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - dialogElement.getBoundingClientRect().left;
        offsetY = e.clientY - dialogElement.getBoundingClientRect().top;
        dialogElement.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        let newX = Math.max(0, e.clientX - offsetX);
        let newY = Math.max(0, e.clientY - offsetY);
        dialogElement.style.left = `${newX}px`;
        dialogElement.style.top = `${newY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        dialogElement.style.cursor = 'default';
    });
}



document.addEventListener("DOMContentLoaded", () => {
    // Build the list
    buildDatasetSelector();

    // Make dialogs draggable
    const datasetHeader = document.getElementById('datasetDialogHeader');
    if (datasetDialog && datasetHeader) makeDraggable(datasetDialog, datasetHeader);

    const plotDialog = document.getElementById('plotOptionsDialog');
    const plotHeader = document.getElementById('plotDialogHeader');
    if(plotDialog && plotHeader) makeDraggable(plotDialog, plotHeader);

    // Trigger initial fetch
    if (typeof fetchClusterData === "function") {
        fetchClusterData(activeDatasets);
    }
});

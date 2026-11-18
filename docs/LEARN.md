# Learn: Galahad teaches

**Galahad becomes a tutor from one file, not from new parts of the apps: [galahad.sh/TUTOR.md](https://galahad.sh/TUTOR.md).** The owner asked on 18 November 2026 for "a learning section… Making Galahad the ultimate tutor, being able to create beautiful visualizations, graphs, figures, displays, challenges", researched for curious, capable learners whose attention follows interest; and later that day: "dont build in learning too much into the apps, but more like a fetchable install/TUTOR.md file on the website, which enables the best tutor, and environment to learn all different kinds of subjects, sciences, programming, robotics, AI. just make sure Galahad can create visual elements, and such aids."

Status, 18 November 2026: TUTOR.md is on galahad.sh (`apps/site/public/TUTOR.md`), and Galahad's guide to what an answer can show (`SHOW_GUIDE` in `packages/brain/src/persona.ts`) names the visual aids a tutor needs. The built-in design that came first ([set aside](#set-aside-the-built-in-design)) is kept on a local branch, not shipped. The research it all rests on, with every source, is in [LEARN-EVIDENCE](LEARN-EVIDENCE.md).

## TUTOR.md

**The tutor's rules and the environment to learn in, in one file a tutor reads: Galahad, or any capable agent.**

- **What it says.** How a session goes (review first, a prediction or an attempt before any explanation, a worked example that fades, a short check, a stop), how to help (never the answer before an attempt; help in steps), that every answer, number and figure is worked out with code before it is shown, how to show things, how to remember what the learner knows and bring it back, how to teach someone under 18, what never to do, and what to install for each kind of subject. Each rule is one of the [ten findings](#ten-findings-ten-rules) below, said as an instruction.
- **On your node.** `curl -fsSL https://galahad.sh/TUTOR.md -o TUTOR.md && galahad project set tutor --name Tutor --instructions-file TUTOR.md` makes a project whose instructions are the file; its chats are the tutor's, and the instructions go with every answer in them. The file is held under a project's 8,000 characters for that (5,264 now), and passes the node's own checks for project instructions.
- **Anywhere else.** Another agent is told to read the file and follow it.
- **What it uses of Galahad, all of which he has:** `sandbox_run` with the Lab image, or his own computer, to check answers and compute figures; `remember` and `recall` for a note per subject on what the learner knows and when to ask again; and his answer blocks for showing things (below).
- **The environment for each subject.** Python with numpy, scipy, sympy, pandas, matplotlib and pint for everyone; the Lab image for physics and engineering (FEniCSx, gmsh, OpenFOAM, OpenSees, ngspice, Cantera, CoolProp, build123d, MuJoCo); MuJoCo, and Gazebo with ROS, for robotics; scikit-learn and PyTorch for AI; Python, Node or Bun and git for programming; Biopython and RDKit for biology and chemistry.

## The visual aids

**What a tutor needs to show, Galahad's answers can show, on every device, with nothing new to install.**

- **Data:** a `chart` block (lines, areas, bars, stacks). **A quick check:** a `choices` block, which a tap answers. **A procedure:** a `steps` block.
- **A figure or a diagram:** an `artifact` page of inline SVG, with each label beside what it names; it shows at once, with no script to run.
- **Maths:** plain text with Unicode in prose (x², ½, √, π, v₀), since no LaTeX is drawn in a chat; anything bigger, MathML in a page, which the browsers and the Apple apps draw themselves.
- **Something to explore or simulate:** an `artifact` page with a canvas and a few sliders; its scripts run only when the learner presses Run, sealed off from the network, the node and their data.
- **Correct before beautiful:** a figure's numbers are worked out with code first and drawn from them, since audits of AI-drawn diagrams find vectors missing or pointing the wrong way ([§7](LEARN-EVIDENCE.md#7-visuals-predict-then-reveal-works-and-motion-earns-its-place-only-as-content)).
- **Still:** nothing moves by itself; motion only under the learner's hand, which is what the evidence supports ([§7](LEARN-EVIDENCE.md#motion-what-the-evidence-supports-banning-and-where-it-helps)) and the owner's word for the whole app.

## Who it's for

**Two learners to begin with: the owner, and the owner's sister, who is 13 ([A young learner](#a-young-learner)).** The research was asked for the first kind, and much of it was done with the second: the interleaving, personalisation and tutoring trials below were run with students of her age.

**A capable, curious adult whose attention follows interest.** They see the why quickly, and tire fast of what they already know. They are slow to start anything that looks like a chore, and put off by noise, pressure and things that move. Some people like this have ADHD or are autistic, or both, and many were never told.

- **No labels.** Learn never asks about, diagnoses or labels anyone, and nothing in it depends on knowing. What helps these learners costs nobody else anything: questions in place of rereading, spaced review, a plan said up front, short starts and a still screen work for nearly every learner ([evidence §1](LEARN-EVIDENCE.md#1-retrieval-and-spacing-lead-and-feeling-fluent-misleads)). It is the curb cut: made for one need, used by everyone.
- **"Lazy" is the wrong word.** Putting things off follows how aversive a task is and how little you expect to succeed at it, and it works as short-term mood repair ([§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points)). Starting is the bottleneck, and a hard start is a property of the task: too big, too vague, too dull or too uncertain. So Learn fixes the task. Each task is small and says what it is and how long it takes. It pays off within minutes, and it is about something you chose.
- **The evidence for this learner is thin.** No controlled study has tested an AI tutor with ADHD, autistic or twice-exceptional adults ([what the evidence does not settle](LEARN-EVIDENCE.md#what-the-evidence-does-not-settle)). The tutor is built on what works for nearly everyone, without what this learner finds aversive, and judged by what its learner can do unaided later.

## Ten findings, ten rules

**Each row is what the evidence says, turned into what the tutor does (TUTOR.md says each as an instruction).** How strong each finding is, and what it was tested on, is in the evidence.

| The evidence | What the tutor does | Evidence |
|---|---|---|
| **Retrieval with feedback, spaced over time, is the core.** Answering beats rereading (g = 0.50; 0.73 with feedback, [Rowland 2014](https://doi.org/10.1037/a0037559)), and spaced practice beats massed (g = 0.74). Small studies of ADHD and autistic adults find the same benefit. Learners feel the opposite: 78% learned more from spacing, and 78% rated massing as good or better. | Most of it is answering, not reading: low-stakes questions, each followed by an explanation, brought back when they're due (a day, three days, a week, a month). Success is what you can do unaided days later, never how easy it felt. | [§1](LEARN-EVIDENCE.md#1-retrieval-and-spacing-lead-and-feeling-fluent-misleads) |
| **Skip the known, topic by topic.** Extra help helps novices (d = 0.51) and hurts those who already know (d = −0.43, [Tetzlaff et al. 2025](https://doi.org/10.1016/j.learninstruc.2025.102142)). Boredom goes with ADHD traits (r = .40) and with learning nothing new. Ability is uneven (under 5% of the top 1% of students had a flat profile), and high ability can hide difficulty. | A short check places you in each topic, and "I know this" is always there: a quick check, then the topic is skipped. Help fades as you get things right. A topic new to you is taught in full, however quick you are elsewhere. | [§1](LEARN-EVIDENCE.md#1-retrieval-and-spacing-lead-and-feeling-fluent-misleads), [§2](LEARN-EVIDENCE.md#2-adhd-delay-and-boredom-are-robust-while-popular-frameworks-are-untested), [§4](LEARN-EVIDENCE.md#4-high-ability-and-2e-boredom-signals-a-task-problem-and-ability-hides-difficulty) |
| **A prediction or an attempt before the explanation.** Prequestions lift memory for what they ask (g = 0.58). Students who predicted a demonstration's outcome got 77% right, against 70% for watching it and 61% for no demonstration ([Crouch et al. 2004](https://www.otffeo.on.ca/en/wp-content/uploads/sites/2/2014/11/Mazur_demo-article.pdf)). | Every explanation starts with you committing to an answer: a choice, a number, a sketch. The explanation then works from what you said. | [§1](LEARN-EVIDENCE.md#1-retrieval-and-spacing-lead-and-feeling-fluent-misleads), [§7](LEARN-EVIDENCE.md#7-visuals-predict-then-reveal-works-and-motion-earns-its-place-only-as-content) |
| **Worked examples, then fading.** In maths, worked examples help novices (g = 0.48), and fading them aids far transfer. A 2025 preprint finds questions alone do less in mathematics (g = 0.22). | A multi-step idea comes as an example you step through, then one with steps left for you, then one of your own. | [§1](LEARN-EVIDENCE.md#1-retrieval-and-spacing-lead-and-feeling-fluent-misleads) |
| **A real payoff soon, never points.** Adults with ADHD prefer sooner rewards (d = 0.40). Informative feedback beats rewards (d = 0.99 against 0.24), and rewards for merely doing a task undermine later interest (d = −0.40). | Something real within minutes: the figure that settles your prediction, code that runs, a result about your own data. No points, badges or levels. | [§2](LEARN-EVIDENCE.md#2-adhd-delay-and-boredom-are-robust-while-popular-frameworks-are-untested), [§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points) |
| **Interests, chosen and deep.** Problems built from what a learner actually does improved algebra, with effects that carried to exams. Coarse interest categories did nothing, and AI-written reskins raised adults' motivation but not their learning. | You say what you're into, and examples are built from it in substance (your own code, your own data), never a theme painted over the same problem. | [§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points) |
| **Predictability and control.** Intolerance of uncertainty goes with anxiety (r = .62). Choice helps most with two to four options, and autistic adults prefer written exchange. | Every session says what comes next and for how long. A choice is two to four real options, terms are defined, and text comes first. | [§3](LEARN-EVIDENCE.md#3-autism-autistic-adults-own-accounts-outrun-the-trials), [§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points) |
| **Expect lapses, and reward the return.** In a 61,293-person megastudy, the best of 54 programmes rewarded coming back after a missed workout ([Milkman et al. 2021](https://doi.org/10.1038/s41586-021-04128-4)). A broken streak hurts most when people blame themselves. | No streak to break. After a gap there is a welcome back and three minutes; what didn't fit waits, uncounted. | [§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points) |
| **A tutor without guardrails does harm.** Unguarded GPT-4 raised practice scores 48% and cut unassisted exam scores 17% ([Bastani et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/)). GPT-4 gave answers away about 47% of the time in a tutoring benchmark, and a tutor that waited to be asked was rarely asked. | No answer before an attempt. Help comes in steps, each opened by trying. He never gives way to a wrong answer pushed back, and every judgment rests on a check. | [§6](LEARN-EVIDENCE.md#6-ai-tutoring-guardrails-prevent-harm-and-broad-gains-stay-small) |
| **A still screen.** Decorative additions lower learning, and motion catches attention whether you want it to or not. Animation helps where the motion is the content (procedures, d = 1.06). | Nothing moves on its own. Motion is content, under your hand: a figure redraws as you drag, and a sequence steps as you tap. | [§7](LEARN-EVIDENCE.md#motion-what-the-evidence-supports-banning-and-where-it-helps) |

## What Galahad has that other tutors don't

**The most dangerous thing an AI tutor gets wrong is being sure of something false, and Galahad has machines to check with.**

- **Programs check, not models.** He works out answers and figures in the Lab, the sandbox image built for mathematics, physics and engineering (`sandbox/lab/`, through `sandbox_run`), or in his own computer. The Lab carries SymPy, SciPy, Pint for units, Z3 and more, each proven against a known answer by `lab-check`, with a read-only root and no network. An expression is compared with its key by SymPy, a number with its tolerance and units, code run against its tests, and a figure's data computed, never written from memory. This is the mandate's first rule, verify, don't assert, and the trials' rule: programs grade, never models ([TRIALS](TRIALS.md)).
- **Your context, when you say so.** He knows your projects, your chats and what your connectors reach, so a subject can be taught from them (statistics from your home's sensors, concurrency from your own repository) when you ask.
- **Your machines.** What he notes of what you know stays in the mind, on your node.
- **Knights.** A knight can prepare material while you're away, checked and reviewed as any task is.
- **The meter.** Tutoring is model calls like any chat: they show on the usage meter, against your budget there (`galahad usage budget`).

## A young learner

**Both model providers the roster uses allow products for minors, with conditions; TUTOR.md's rules for a learner under 18 meet those that are a tutor's to keep.**

- **Anthropic** (its guidance for organizations serving minors, dated 16 March 2026): age assurance so only intended users get in, content moderation and filtering, monitoring and reporting, guidance for minors on safe use, Anthropic's child-safety system prompt where offered, compliance with child-safety and privacy law, and telling the user they are talking to an AI ([source](https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors)).
- **OpenAI** (its under-18 API guidance): no personal data of a child under 13, or under the age of digital consent where they live, without zero data retention; age-appropriate content filters; monitoring with an escalation path for high-risk exchanges ([source](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)).
- **A personal subscription is for its holder.** A chat's answer never runs on a coding plan (they give only coding work), and a consumer subscription is for the one who holds it.

What TUTOR.md has the tutor do for someone under 18: say plainly that it is an AI, keep to learning and to what suits their age, ask for nothing personal, answer anything harmful or frightening with care and point them to a trusted adult, and use no tool that acts in the world for them. Since the owner's sister is 13, her parents should know what it is and agree; that is for the family.

**Open, the owner's to decide:** with TUTOR.md, a learner's chats are kept on your node like your own, and any device that may chat sees every chat there and reaches Galahad's tools within its scopes. A device of the sister's own that sees only her learning, with a tutor that has no tools, needs the separation the [set-aside](#set-aside-the-built-in-design) work had (a device paired for Learn alone, acting only as its learner).

## Privacy and limits

- **What he notes of what you know stays on your machines**, in the mind on your node; the model providers see a tutoring chat as they see any chat.
- **He notes what you learned, never who you are:** no traits, no health, no diagnosis.
- **Nothing is built to hold you in the app**, in keeping with the EU AI Act's Article 5 ([§5](LEARN-EVIDENCE.md#5-motivation-value-and-return-beat-pressure-and-points)).
- **It claims to treat nothing.**

## Set aside: the built-in design

**First designed, then partly built, before the owner chose the file: kept on the local branch `t3/learn-built-in`, never shipped.**

- **On the node** (built and tested): learners besides the owner with devices of their own, a scope `learn` that reaches Learn alone, subjects of questions Galahad wrote and the Lab checked, answers checked by a program (numbers within a tolerance; formulas compared by computing both), review on a schedule (ts-fsrs, MIT), a monthly budget that stops new subjects, and `galahad learn`.
- **In the apps** (written and compiled, never released): a Learn page on the iPhone and iPad (the whole app on a device for Learn alone), a review card in Galahad's chat, and the web app's Learn page.
- **What it would still have needed:** lessons of blocks (figures, explorables, sketches, worked examples), a live tutor without tools, and a widget.

## The owner's answers

On 18 November 2026:

1. **Subjects:** "Physics Maths Bio Robotics Civil engineering Programming Design and much more." TUTOR.md takes all of them: a program checks what can be computed, sources what can't, and a judgment is labelled as one.
2. **Learners:** "for others too, my sister 13yo. She uses an iPad." ([A young learner](#a-young-learner); a device of her own is the open question there.)
3. **Budget:** €50 a month. With no Learn of its own, tutoring is ordinary chats on the usage meter, whose budget is a line to watch (`galahad usage budget`).
4. **Dependencies:** the MIT-licensed ones (ts-fsrs, SwiftMath). TUTOR.md needs neither: the set-aside work used ts-fsrs, and maths is Unicode in a chat and MathML in a page.
5. **A tab:** no, "some other way to engage with it". Then the file, in place of anything in the apps.
6. **"Displays":** no particular meaning; [the visual aids](#the-visual-aids) cover it.

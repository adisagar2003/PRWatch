import type { PR } from './forge/types.js';

export function buildPrompt(rubric: string, repo: string, pr: PR): string {
  return `You are reviewing pull request #${pr.number} ("${pr.title}") in ${repo}.
You are inside a checkout of the PR branch. Inspect the changes with:
  git log --oneline -20
  git diff origin/HEAD...HEAD
Read any surrounding source files you need for context.

PR description:
${pr.body || '(no description)'}

Review the changes against this rubric:

${rubric}

Output ONLY the final review in GitHub-flavored markdown, following the rubric's output format. No preamble, no tool logs.`;
}

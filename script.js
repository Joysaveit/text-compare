// HTML转义函数
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, "<br>");
}

function normalizeLineBreaks(text) {
    return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeComparableText(text) {
    return (text || '').trim().replace(/\s+/g, ' ');
}

function createDiffSpan(className, text, type) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    span.style.cursor = 'pointer';
    span.title = '点击跳转到此差异';
    span.addEventListener('click', function() {
        const diffIndex = diffNavigator.diffs.findIndex(diff => diff.element === span);
        if (diffIndex !== -1) {
            diffNavigator.jumpTo(diffIndex);
        }
    });
    diffNavigator.addDiff(type, text, span);
    return span;
}

function appendInlineDiffs(diffs, originalParent, modifiedParent) {
    diffs.forEach(diff => {
        const type = diff[0];
        const text = diff[1];
        if (type === -1) {
            originalParent.appendChild(createDiffSpan('diff-delete', text, 'delete'));
        } else if (type === 1) {
            modifiedParent.appendChild(createDiffSpan('diff-insert', text, 'insert'));
        } else {
            originalParent.appendChild(document.createTextNode(text));
            modifiedParent.appendChild(document.createTextNode(text));
        }
    });
}

function createLineElement() {
    const line = document.createElement('div');
    line.className = 'text-compare-line';
    return line;
}

function appendPlainLine(container, text) {
    const line = createLineElement();
    if (text) {
        line.textContent = text;
    } else {
        line.classList.add('line-placeholder');
        line.textContent = '\u00A0';
    }
    container.appendChild(line);
    return line;
}

function appendPlaceholderLine(container) {
    return appendPlainLine(container, '');
}

function getIssueSummary(issue) {
    return `${getIssueTypeLabel(issue)}：第${issue.blockIndex}组，第${issue.lineNumber}行，${issue.level === 2 ? `二级列表（父项${issue.parentOrder}）` : '一级列表'}，期望${issue.expectedValue}，实际${issue.actualValue}${issue.prefixText ? `，序号${issue.prefixText}` : ''}`;
}

function buildIssueMap(analysis) {
    const issueMap = new Map();

    analysis.validationIssues.forEach(issue => {
        const list = issueMap.get(issue.lineNumber) || [];
        list.push(issue);
        issueMap.set(issue.lineNumber, list);
    });

    return issueMap;
}

function applyIssueDecoration(lineElement, issues) {
    if (!issues || issues.length === 0 || !lineElement) return;
    lineElement.title = issues.map(getIssueSummary).join('\n');
}

function appendPrefixContent(target, prefixText, issues) {
    const prefix = prefixText || '';
    if (!prefix) return;

    if (issues && issues.length > 0) {
        const span = document.createElement('span');
        span.className = 'numbering-issue-prefix';
        span.textContent = prefix;
        span.title = issues.map(getIssueSummary).join('\n');
        target.appendChild(span);
        return;
    }

    target.appendChild(document.createTextNode(prefix));
}

class ListNumberingAnalyzer {
    static analyze(text, side) {
        const rawLines = normalizeLineBreaks(text).split('\n');
        const lines = [];
        let blockIndex = 0;
        let previousWasList = false;
        let currentLevel1 = null;
        let currentLevel1Sequence = 0;

        rawLines.forEach((rawLine, index) => {
            const baseLine = this.parseLine(rawLine, index + 1);

            if (!baseLine.isList) {
                previousWasList = false;
                currentLevel1 = null;
                currentLevel1Sequence = 0;
                lines.push(baseLine);
                return;
            }

            if (!previousWasList) {
                blockIndex += 1;
                currentLevel1 = null;
                currentLevel1Sequence = 0;
            }

            const resolvedLine = this.resolveLine(baseLine, blockIndex, currentLevel1, currentLevel1Sequence);
            lines.push(resolvedLine);

            if (resolvedLine.level === 1) {
                currentLevel1Sequence += 1;
                currentLevel1 = {
                    order: resolvedLine.order,
                    lineNumber: resolvedLine.lineNumber,
                    blockIndex,
                    numberingStyle: resolvedLine.numberingStyle,
                    sequenceIndex: currentLevel1Sequence
                };
                resolvedLine.sequenceIndex = currentLevel1Sequence;
            }

            previousWasList = true;
        });

        const validationIssues = this.validate(lines, side);
        const listLineCount = lines.filter(line => line.isList).length;

        return {
            side,
            text,
            lines,
            listLineCount,
            validationIssues
        };
    }

    static parseLine(rawLine, lineNumber) {
        const leadingWhitespaceMatch = rawLine.match(/^(\s*)/);
        const indent = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';
        const trimmed = rawLine.trim();

        if (!trimmed) {
            return {
                rawLine,
                lineNumber,
                indent,
                trimmed,
                isBlank: true,
                isList: false
            };
        }

        const explicitSecondLevel = rawLine.match(/^(\s*)(\d+)\.(\d+)(?:([、.)．。])|(\s+))?(.*)$/);
        if (explicitSecondLevel) {
            const separator = explicitSecondLevel[4] || explicitSecondLevel[5] || '';
            return {
                rawLine,
                lineNumber,
                indent: explicitSecondLevel[1],
                trimmed,
                isBlank: false,
                isList: true,
                candidateKind: 'explicit-secondary',
                numberingStyle: 'multi-dot',
                prefixText: `${explicitSecondLevel[1]}${explicitSecondLevel[2]}.${explicitSecondLevel[3]}${separator}`,
                bodyText: explicitSecondLevel[6] || '',
                primaryValue: Number(explicitSecondLevel[2]),
                secondaryValue: Number(explicitSecondLevel[3]),
                canBeImplicitChild: false
            };
        }

        const parenthesizedNumeric = rawLine.match(/^(\s*)([（(])(\d+)([）)])(?:([、.)．。])|(\s+))?(.*)$/);
        if (parenthesizedNumeric) {
            const separator = parenthesizedNumeric[5] || parenthesizedNumeric[6] || '';
            return {
                rawLine,
                lineNumber,
                indent: parenthesizedNumeric[1],
                trimmed,
                isBlank: false,
                isList: true,
                candidateKind: 'parenthesized-numeric',
                numberingStyle: 'parenthesized-numeric',
                prefixText: `${parenthesizedNumeric[1]}${parenthesizedNumeric[2]}${parenthesizedNumeric[3]}${parenthesizedNumeric[4]}${separator}`,
                bodyText: parenthesizedNumeric[7] || '',
                primaryValue: Number(parenthesizedNumeric[3]),
                canBeImplicitChild: true
            };
        }

        const numeric = rawLine.match(/^(\s*)(\d+)([、.)．。]|\s+)(.*)$/);
        if (numeric) {
            const separator = numeric[3] || '';
            return {
                rawLine,
                lineNumber,
                indent: numeric[1],
                trimmed,
                isBlank: false,
                isList: true,
                candidateKind: separator.trim() ? 'numeric-punctuation' : 'numeric-whitespace',
                numberingStyle: separator.trim() ? `numeric-${separator}` : 'numeric-whitespace',
                prefixText: `${numeric[1]}${numeric[2]}${separator}`,
                bodyText: numeric[4] || '',
                primaryValue: Number(numeric[2]),
                canBeImplicitChild: separator.trim() && /[.)．。]/.test(separator)
            };
        }

        const chineseWithDi = rawLine.match(/^(\s*)第([零〇一二三四五六七八九十百千两]+)(?:([章节条项、.)．。])|(\s+))?(.*)$/);
        if (chineseWithDi) {
            const value = this.parseChineseNumber(chineseWithDi[2]);
            if (value !== null) {
                const separator = chineseWithDi[3] || chineseWithDi[4] || '';
                return {
                    rawLine,
                    lineNumber,
                    indent: chineseWithDi[1],
                    trimmed,
                    isBlank: false,
                    isList: true,
                    candidateKind: 'chinese-level-one',
                    numberingStyle: 'chinese-with-di',
                    prefixText: `${chineseWithDi[1]}第${chineseWithDi[2]}${separator}`,
                    bodyText: chineseWithDi[5] || '',
                    primaryValue: value,
                    canBeImplicitChild: false
                };
            }
        }

        const chinese = rawLine.match(/^(\s*)([零〇一二三四五六七八九十百千两]+)([、.)．。]|\s+)(.*)$/);
        if (chinese) {
            const value = this.parseChineseNumber(chinese[2]);
            if (value !== null) {
                return {
                    rawLine,
                    lineNumber,
                    indent: chinese[1],
                    trimmed,
                    isBlank: false,
                    isList: true,
                    candidateKind: 'chinese-level-one',
                    numberingStyle: `chinese-${chinese[3]}`,
                    prefixText: `${chinese[1]}${chinese[2]}${chinese[3]}`,
                    bodyText: chinese[4] || '',
                    primaryValue: value,
                    canBeImplicitChild: false
                };
            }
        }

        return {
            rawLine,
            lineNumber,
            indent,
            trimmed,
            isBlank: false,
            isList: false
        };
    }

    static resolveLine(baseLine, blockIndex, currentLevel1, currentLevel1Sequence) {
        const normalizedBody = normalizeComparableText(baseLine.bodyText);

        if (baseLine.candidateKind === 'explicit-secondary') {
            const hasMatchedParent = currentLevel1 && currentLevel1.order === baseLine.primaryValue;
            const parentRef = hasMatchedParent
                ? currentLevel1.lineNumber
                : `virtual:${blockIndex}:${baseLine.primaryValue}`;

            return {
                ...baseLine,
                blockIndex,
                level: 2,
                order: baseLine.secondaryValue,
                parentOrder: baseLine.primaryValue,
                parentRef,
                parentSequence: hasMatchedParent ? currentLevel1.sequenceIndex : baseLine.primaryValue,
                normalizedBody
            };
        }

        if (
            baseLine.canBeImplicitChild &&
            currentLevel1 &&
            currentLevel1.blockIndex === blockIndex &&
            currentLevel1.numberingStyle !== baseLine.numberingStyle
        ) {
            return {
                ...baseLine,
                blockIndex,
                level: 2,
                order: baseLine.primaryValue,
                parentOrder: currentLevel1.order,
                parentRef: currentLevel1.lineNumber,
                parentSequence: currentLevel1.sequenceIndex,
                normalizedBody
            };
        }

        return {
            ...baseLine,
            blockIndex,
            level: 1,
            order: baseLine.primaryValue,
            parentOrder: null,
            parentRef: null,
            parentSequence: null,
            sequenceIndex: currentLevel1Sequence + 1,
            normalizedBody
        };
    }

    static parseChineseNumber(text) {
        if (!text) return null;

        const digitMap = {
            '零': 0,
            '〇': 0,
            '一': 1,
            '二': 2,
            '两': 2,
            '三': 3,
            '四': 4,
            '五': 5,
            '六': 6,
            '七': 7,
            '八': 8,
            '九': 9
        };
        const unitMap = {
            '十': 10,
            '百': 100,
            '千': 1000
        };

        let total = 0;
        let current = 0;

        for (const char of text) {
            if (Object.prototype.hasOwnProperty.call(digitMap, char)) {
                current = digitMap[char];
                continue;
            }

            if (Object.prototype.hasOwnProperty.call(unitMap, char)) {
                const unit = unitMap[char];
                total += (current || 1) * unit;
                current = 0;
                continue;
            }

            return null;
        }

        return total + current;
    }

    static validate(lines, side) {
        const issues = [];
        const blocks = new Map();

        lines.filter(line => line.isList).forEach(line => {
            const bucket = blocks.get(line.blockIndex) || [];
            bucket.push(line);
            blocks.set(line.blockIndex, bucket);
        });

        blocks.forEach((blockLines, blockIndex) => {
            const levelOneLines = blockLines.filter(line => line.level === 1);
            issues.push(...this.validateSequence(levelOneLines, {
                side,
                blockIndex,
                level: 1
            }));

            const childGroups = new Map();
            blockLines.filter(line => line.level === 2).forEach(line => {
                const bucket = childGroups.get(line.parentRef) || [];
                bucket.push(line);
                childGroups.set(line.parentRef, bucket);
            });

            childGroups.forEach(groupLines => {
                issues.push(...this.validateSequence(groupLines, {
                    side,
                    blockIndex,
                    level: 2,
                    parentOrder: groupLines[0].parentOrder
                }));
            });
        });

        return issues.sort((a, b) => a.lineNumber - b.lineNumber);
    }

    static validateSequence(sequenceLines, context) {
        const issues = [];
        let previous = null;

        sequenceLines.forEach((line, index) => {
            const expected = previous === null ? 1 : previous + 1;

            if (line.order === expected) {
                previous = line.order;
                return;
            }

            let type = 'jump';
            if (previous !== null) {
                if (line.order === previous) {
                    type = 'duplicate';
                } else if (line.order < previous) {
                    type = 'backward';
                } else if (line.order > previous + 1) {
                    type = 'skip';
                }
            }

            issues.push({
                side: context.side,
                blockIndex: context.blockIndex,
                level: context.level,
                parentOrder: context.parentOrder || null,
                type,
                expectedValue: expected,
                actualValue: line.order,
                lineNumber: line.lineNumber,
                prefixText: (line.prefixText || '').trim(),
                bodyText: line.bodyText || '',
                isFirstItem: index === 0
            });

            previous = line.order;
        });

        return issues;
    }
}

class NumberingAwareTextComparer {
    static compare(originalAnalysis, modifiedAnalysis) {
        const originalListLines = originalAnalysis.lines;
        const modifiedListLines = modifiedAnalysis.lines;
        const alignedOperations = this.alignLines(originalListLines, modifiedListLines);

        return {
            operations: alignedOperations
        };
    }

    static alignLines(originalLines, modifiedLines) {
        const originalTokens = originalLines.map(line => this.getAlignmentToken(line));
        const modifiedTokens = modifiedLines.map(line => this.getAlignmentToken(line));
        const dp = Array.from({ length: originalTokens.length + 1 }, () => Array(modifiedTokens.length + 1).fill(0));

        for (let i = originalTokens.length - 1; i >= 0; i--) {
            for (let j = modifiedTokens.length - 1; j >= 0; j--) {
                if (originalTokens[i] === modifiedTokens[j]) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        const rawOperations = [];
        let i = 0;
        let j = 0;

        while (i < originalLines.length && j < modifiedLines.length) {
            if (originalTokens[i] === modifiedTokens[j]) {
                rawOperations.push({
                    type: 'equal',
                    original: originalLines[i],
                    modified: modifiedLines[j]
                });
                i += 1;
                j += 1;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                rawOperations.push({
                    type: 'delete',
                    original: originalLines[i]
                });
                i += 1;
            } else {
                rawOperations.push({
                    type: 'insert',
                    modified: modifiedLines[j]
                });
                j += 1;
            }
        }

        while (i < originalLines.length) {
            rawOperations.push({
                type: 'delete',
                original: originalLines[i]
            });
            i += 1;
        }

        while (j < modifiedLines.length) {
            rawOperations.push({
                type: 'insert',
                modified: modifiedLines[j]
            });
            j += 1;
        }

        return this.mergeReplaceOperations(rawOperations);
    }

    static getAlignmentToken(line) {
        if (line.isBlank) {
            return 'BLANK';
        }

        if (!line.isList) {
            return `TEXT|${line.rawLine}`;
        }

        return `LIST|${line.blockIndex}|${line.level}|${line.parentSequence || 0}|${line.bodyText}`;
    }

    static mergeReplaceOperations(rawOperations) {
        const merged = [];
        let index = 0;

        while (index < rawOperations.length) {
            const current = rawOperations[index];
            if (current.type === 'equal') {
                merged.push(current);
                index += 1;
                continue;
            }

            const deletes = [];
            const inserts = [];

            while (index < rawOperations.length && rawOperations[index].type !== 'equal') {
                if (rawOperations[index].type === 'delete') {
                    deletes.push(rawOperations[index].original);
                } else if (rawOperations[index].type === 'insert') {
                    inserts.push(rawOperations[index].modified);
                }
                index += 1;
            }

            merged.push(...this.pairReplaceOperations(deletes, inserts));
        }

        return merged;
    }

    static pairReplaceOperations(deletes, inserts) {
        const operations = [];
        let deleteIndex = 0;
        let insertIndex = 0;

        while (deleteIndex < deletes.length || insertIndex < inserts.length) {
            const deleteLine = deletes[deleteIndex];
            const insertLine = inserts[insertIndex];

            if (deleteLine && insertLine && this.canPairAsReplace(deleteLine, insertLine)) {
                operations.push({
                    type: 'replace',
                    original: deleteLine,
                    modified: insertLine
                });
                deleteIndex += 1;
                insertIndex += 1;
                continue;
            }

            if (deleteLine && (!insertLine || deletes.length - deleteIndex >= inserts.length - insertIndex)) {
                operations.push({
                    type: 'delete',
                    original: deleteLine
                });
                deleteIndex += 1;
                continue;
            }

            if (insertLine) {
                operations.push({
                    type: 'insert',
                    modified: insertLine
                });
                insertIndex += 1;
            }
        }

        return operations;
    }

    static canPairAsReplace(originalLine, modifiedLine) {
        if (!originalLine || !modifiedLine) return false;
        if (originalLine.isBlank || modifiedLine.isBlank) return false;
        if (originalLine.isList !== modifiedLine.isList) return false;

        if (!originalLine.isList) {
            return true;
        }

        return originalLine.blockIndex === modifiedLine.blockIndex &&
            originalLine.level === modifiedLine.level &&
            (originalLine.level === 1 || originalLine.parentSequence === modifiedLine.parentSequence);
    }

    static normalizeDiffEntries(diffs) {
        return diffs.map(diff => [diff[0], diff[1]]);
    }

    static renderComparison(comparison, originalElement, modifiedElement) {
        originalElement.innerHTML = '';
        modifiedElement.innerHTML = '';
        diffNavigator.clear();

        comparison.operations.forEach(operation => {
            if (operation.type === 'equal') {
                const originalLine = appendPlainLine(originalElement, operation.original.rawLine);
                const modifiedLine = appendPlainLine(modifiedElement, operation.modified.rawLine);
                applyIssueDecoration(originalLine, operation.original.validationIssues);
                applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
                return;
            }

            if (operation.type === 'delete') {
                const originalLine = createLineElement();
                originalLine.appendChild(createDiffSpan('diff-delete', operation.original.rawLine, 'delete'));
                applyIssueDecoration(originalLine, operation.original.validationIssues);
                originalElement.appendChild(originalLine);
                appendPlaceholderLine(modifiedElement);
                return;
            }

            if (operation.type === 'insert') {
                appendPlaceholderLine(originalElement);
                const modifiedLine = createLineElement();
                modifiedLine.appendChild(createDiffSpan('diff-insert', operation.modified.rawLine, 'insert'));
                applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
                modifiedElement.appendChild(modifiedLine);
                return;
            }

            const originalLine = createLineElement();
            const modifiedLine = createLineElement();

            if (operation.original.isList && operation.modified.isList) {
                appendPrefixContent(originalLine, operation.original.prefixText, operation.original.validationIssues);
                appendPrefixContent(modifiedLine, operation.modified.prefixText, operation.modified.validationIssues);

                if (operation.original.bodyText === operation.modified.bodyText) {
                    originalLine.appendChild(document.createTextNode(operation.original.bodyText || ''));
                    modifiedLine.appendChild(document.createTextNode(operation.modified.bodyText || ''));
                } else {
                    const dmp = new diff_match_patch();
                    let bodyDiffs = dmp.diff_main(operation.original.bodyText || '', operation.modified.bodyText || '');
                    dmp.diff_cleanupSemantic(bodyDiffs);
                    bodyDiffs = this.normalizeDiffEntries(bodyDiffs);
                    appendInlineDiffs(bodyDiffs, originalLine, modifiedLine);
                }
            } else {
                const dmp = new diff_match_patch();
                let textDiffs = dmp.diff_main(operation.original.rawLine || '', operation.modified.rawLine || '');
                dmp.diff_cleanupSemantic(textDiffs);
                textDiffs = this.normalizeDiffEntries(textDiffs);
                appendInlineDiffs(textDiffs, originalLine, modifiedLine);
            }

            applyIssueDecoration(originalLine, operation.original.validationIssues);
            applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
            originalElement.appendChild(originalLine);
            modifiedElement.appendChild(modifiedLine);
        });
    }
}

class StandardTextComparer {
    static compare(originalAnalysis, modifiedAnalysis) {
        return {
            operations: NumberingAwareTextComparer.alignLines(originalAnalysis.lines, modifiedAnalysis.lines)
        };
    }

    static renderComparison(comparison, originalElement, modifiedElement) {
        originalElement.innerHTML = '';
        modifiedElement.innerHTML = '';
        diffNavigator.clear();

        comparison.operations.forEach(operation => {
            if (operation.type === 'equal') {
                const originalLine = createLineElement();
                const modifiedLine = createLineElement();

                if (operation.original.prefixText) {
                    appendPrefixContent(originalLine, operation.original.prefixText, operation.original.validationIssues);
                    originalLine.appendChild(document.createTextNode(operation.original.bodyText || ''));
                } else {
                    originalLine.textContent = operation.original.rawLine;
                }

                if (operation.modified.prefixText) {
                    appendPrefixContent(modifiedLine, operation.modified.prefixText, operation.modified.validationIssues);
                    modifiedLine.appendChild(document.createTextNode(operation.modified.bodyText || ''));
                } else {
                    modifiedLine.textContent = operation.modified.rawLine;
                }

                applyIssueDecoration(originalLine, operation.original.validationIssues);
                applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
                originalElement.appendChild(originalLine);
                modifiedElement.appendChild(modifiedLine);
                return;
            }

            if (operation.type === 'delete') {
                const originalLine = createLineElement();
                if (operation.original.prefixText) {
                    appendPrefixContent(originalLine, operation.original.prefixText, operation.original.validationIssues);
                    if (operation.original.bodyText) {
                        originalLine.appendChild(createDiffSpan('diff-delete', operation.original.bodyText, 'delete'));
                    }
                } else if (operation.original.rawLine) {
                    originalLine.appendChild(createDiffSpan('diff-delete', operation.original.rawLine, 'delete'));
                } else {
                    originalLine.classList.add('line-placeholder');
                    originalLine.textContent = '\u00A0';
                }
                applyIssueDecoration(originalLine, operation.original.validationIssues);
                originalElement.appendChild(originalLine);
                appendPlaceholderLine(modifiedElement);
                return;
            }

            if (operation.type === 'insert') {
                appendPlaceholderLine(originalElement);
                const modifiedLine = createLineElement();
                if (operation.modified.prefixText) {
                    appendPrefixContent(modifiedLine, operation.modified.prefixText, operation.modified.validationIssues);
                    if (operation.modified.bodyText) {
                        modifiedLine.appendChild(createDiffSpan('diff-insert', operation.modified.bodyText, 'insert'));
                    }
                } else if (operation.modified.rawLine) {
                    modifiedLine.appendChild(createDiffSpan('diff-insert', operation.modified.rawLine, 'insert'));
                } else {
                    modifiedLine.classList.add('line-placeholder');
                    modifiedLine.textContent = '\u00A0';
                }
                applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
                modifiedElement.appendChild(modifiedLine);
                return;
            }

            const originalLine = createLineElement();
            const modifiedLine = createLineElement();

            if (operation.original.isList && operation.modified.isList) {
                appendPrefixContent(originalLine, operation.original.prefixText, operation.original.validationIssues);
                appendPrefixContent(modifiedLine, operation.modified.prefixText, operation.modified.validationIssues);

                if (operation.original.bodyText === operation.modified.bodyText) {
                    originalLine.appendChild(document.createTextNode(operation.original.bodyText || ''));
                    modifiedLine.appendChild(document.createTextNode(operation.modified.bodyText || ''));
                } else {
                    const dmp = new diff_match_patch();
                    let diffs = dmp.diff_main(operation.original.bodyText || '', operation.modified.bodyText || '');
                    dmp.diff_cleanupSemantic(diffs);
                    diffs = NumberingAwareTextComparer.normalizeDiffEntries(diffs);
                    appendInlineDiffs(diffs, originalLine, modifiedLine);
                }
            } else {
                const dmp = new diff_match_patch();
                let diffs = dmp.diff_main(operation.original.rawLine || '', operation.modified.rawLine || '');
                dmp.diff_cleanupSemantic(diffs);
                diffs = NumberingAwareTextComparer.normalizeDiffEntries(diffs);
                appendInlineDiffs(diffs, originalLine, modifiedLine);
            }

            applyIssueDecoration(originalLine, operation.original.validationIssues);
            applyIssueDecoration(modifiedLine, operation.modified.validationIssues);
            originalElement.appendChild(originalLine);
            modifiedElement.appendChild(modifiedLine);
        });
    }
}

function getIssueTypeLabel(issue) {
    if (issue.type === 'duplicate') return '重复';
    if (issue.type === 'backward') return '回退';
    if (issue.type === 'skip') return '跳号';
    return issue.isFirstItem ? '起始异常' : '跳号';
}

function renderListValidationPanel(panel, originalAnalysis, modifiedAnalysis) {
    if (!panel) return;

    const analyses = [originalAnalysis, modifiedAnalysis];
    const hasListContent = analyses.some(analysis => analysis.listLineCount > 0);

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="list-validation-inline">
            ${analyses.map(analysis => {
                const hasIssues = analysis.validationIssues.length > 0;
                const summaryText = analysis.listLineCount > 0
                    ? `${analysis.listLineCount} 条列表行`
                    : '未识别到可校验的列表序号';
                const statusText = hasIssues
                    ? `发现 ${analysis.validationIssues.length} 处编号异常`
                    : (analysis.listLineCount > 0 ? '未发现编号异常' : '当前文本中没有可校验的列表块');
                const issueTitle = hasIssues
                    ? analysis.validationIssues.map(getIssueSummary).join(' | ')
                    : statusText;

                return `
                    <div class="list-validation-inline-item ${hasIssues ? 'has-issues' : ''}" title="${escapeHtml(issueTitle)}">
                        <span class="list-validation-label">${escapeHtml(analysis.side)}</span>
                        <span class="list-validation-summary">${summaryText}</span>
                        <span class="${analysis.listLineCount > 0 ? (hasIssues ? 'list-validation-bad' : 'list-validation-ok') : 'list-validation-empty'}">${statusText}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    if (!hasListContent) {
        panel.classList.remove('has-issues');
        return;
    }

    if (analyses.some(analysis => analysis.validationIssues.length > 0)) {
        panel.classList.add('has-issues');
    } else {
        panel.classList.remove('has-issues');
    }
}

function clearListValidationPanel(panel) {
    if (!panel) return;
    panel.innerHTML = '';
    panel.style.display = 'none';
    panel.classList.remove('has-issues');
}

function renderStandardTextDiff(original, modified, originalResult, modifiedResult) {
    if (original === modified) {
        originalResult.textContent = '两段文本完全相同';
        modifiedResult.textContent = '未检测到差异';
        return 0;
    }

    const dmp = new diff_match_patch();
    let diffs = dmp.diff_main(original, modified);
    dmp.diff_cleanupSemantic(diffs);
    diffs = diffs.map(diff => [diff[0], diff[1]]);

    diffNavigator.clear();
    originalResult.innerHTML = '';
    modifiedResult.innerHTML = '';

    diffs.forEach(diff => {
        const type = diff[0];
        const text = diff[1];

        if (type === -1) {
            const span = createDiffSpan('diff-delete', text, 'delete');
            originalResult.appendChild(span);
        } else if (type === 1) {
            const span = createDiffSpan('diff-insert', text, 'insert');
            modifiedResult.appendChild(span);
        } else {
            originalResult.appendChild(document.createTextNode(text));
            modifiedResult.appendChild(document.createTextNode(text));
        }
    });

    return diffNavigator.diffs.length;
}

// 表格数据解析和对比功能
class TableParser {
    static parseTableData(input) {
        if (!input || !input.trim()) return [];
        
        input = this.cleanPastedText(input);
        
        // 尝试解析JSON
        if ((input.startsWith('[') && input.endsWith(']')) || 
            (input.startsWith('{') && input.endsWith('}'))) {
            try {
                const parsed = JSON.parse(input);
                if (Array.isArray(parsed)) {
                    return parsed;
                } else if (typeof parsed === 'object') {
                    return [parsed];
                }
            } catch (e) {
                // JSON解析失败，继续尝试其他格式
            }
        }
        
        // 处理Excel/Word复制的表格
        return this.parseExcelWordTable(input);
    }
    
    static cleanPastedText(text) {
        // 清理从Word/Excel复制的格式
        return text
            .replace(/\r\n/g, '\n')  // 统一换行符
            .replace(/\r/g, '\n')
            .replace(/\u00A0/g, ' ')  // 移除不间断空格
            .replace(/\u200B/g, '')  // 移除零宽空格
            .replace(/\u0009/g, '\t') // 统一制表符
            .trim();
    }
    
    static parseExcelWordTable(input) {
        const lines = input.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];
        
        // 检测Excel/Word复制的格式
        let delimiter = this.detectDelimiter(input);
        
        const result = [];
        
        // 不将第一行作为表头，使用列索引作为键
        const allLines = lines.map(line => this.parseLine(line, delimiter));
        const maxColumns = Math.max(...allLines.map(line => line.length));
        
        for (let i = 0; i < lines.length; i++) {
            const values = this.parseLine(lines[i], delimiter);
            if (values.length > 0) {
                const row = {};
                // 使用列索引作为键名（从1开始）
                for (let j = 0; j < values.length; j++) {
                    row[`列${j+1}`] = values[j] || '';
                }
                // 填充空列
                for (let j = values.length; j < maxColumns; j++) {
                    row[`列${j+1}`] = '';
                }
                result.push(row);
            }
        }
        
        return result;
    }
    
    static detectDelimiter(text) {
        // 优先检测制表符（Excel复制）
        if (text.includes('\t')) return '\t';
        
        // 检测其他常见分隔符
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
            const firstLine = lines[0];
            
            // 检测逗号
            if (firstLine.includes(',')) return ',';
            
            // 检测分号
            if (firstLine.includes(';')) return ';';
            
            // 检测竖线
            if (firstLine.includes('|')) return '|';
            
            // 检测空格（Word表格）
            if (firstLine.includes('  ')) return '  ';
        }
        
        return '\t'; // 默认使用制表符
    }
    
    static parseLine(line, delimiter) {
        if (!line.trim()) return [];
        
        // 处理引号内的内容
        if (delimiter === '\t') {
            return line.split('\t').map(cell => 
                cell.trim().replace(/^["']|["']$/g, '')
            );
        } else if (delimiter === '  ') {
            // 处理Word表格的空格分隔
            return line.split(/\s{2,}/).map(cell => cell.trim());
        } else {
            // 处理CSV格式
            return this.parseCSVLine(line);
        }
    }
    
    static detectFormat(input) {
        if (!input || !input.trim()) return 'unknown';
        
        input = input.trim();
        
        if ((input.startsWith('[') && input.endsWith(']')) || 
            (input.startsWith('{') && input.endsWith('}'))) {
            try {
                JSON.parse(input);
                return 'json';
            } catch (e) {
                return 'unknown';
            }
        }
        
        const lines = input.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
            if (lines[0].includes('\t')) return 'tsv';
            if (lines[0].includes(',')) return 'csv';
        }
        
        return 'csv';
    }
}

class TableDiff {
    static computeTableDiff(originalData, modifiedData) {
        const diff = {
            addedRows: [],
            removedRows: [],
            modifiedRows: [],
            unchangedRows: [],
            summary: {
                totalRows: { original: originalData.length, modified: modifiedData.length },
                added: 0,
                removed: 0,
                modified: 0,
                unchanged: 0
            }
        };
        
        // 创建行的键值映射用于匹配
        const originalMap = new Map();
        const modifiedMap = new Map();
        
        originalData.forEach((row, index) => {
            const key = JSON.stringify(Object.values(row));
            originalMap.set(key, { row, index });
        });
        
        modifiedData.forEach((row, index) => {
            const key = JSON.stringify(Object.values(row));
            modifiedMap.set(key, { row, index });
        });
        
        // 检测新增和删除的行
        originalData.forEach((row, index) => {
            const key = JSON.stringify(Object.values(row));
            if (!modifiedMap.has(key)) {
                diff.removedRows.push({ row, index, key });
            }
        });
        
        modifiedData.forEach((row, index) => {
            const key = JSON.stringify(Object.values(row));
            if (!originalMap.has(key)) {
                diff.addedRows.push({ row, index, key });
            }
        });
        
        // 检测修改的行（相同的键但内容不同）
        const originalKeys = Array.from(originalMap.keys());
        const modifiedKeys = Array.from(modifiedMap.keys());
        
        originalKeys.forEach(key => {
            if (modifiedKeys.includes(key)) {
                const originalRow = originalMap.get(key);
                const modifiedRow = modifiedMap.get(key);
                
                // 检查是否有实际修改
                const originalValues = Object.values(originalRow.row);
                const modifiedValues = Object.values(modifiedRow.row);
                
                if (JSON.stringify(originalValues) !== JSON.stringify(modifiedValues)) {
                    // 逐字段对比
                    const cellDiffs = [];
                    const keys = [...new Set([...Object.keys(originalRow.row), ...Object.keys(modifiedRow.row)])];
                    
                    keys.forEach(field => {
                        const originalValue = originalRow.row[field] || '';
                        const modifiedValue = modifiedRow.row[field] || '';
                        
                        if (originalValue !== modifiedValue) {
                            cellDiffs.push({
                                field,
                                original: originalValue,
                                modified: modifiedValue,
                                type: 'modified'
                            });
                        }
                    });
                    
                    if (cellDiffs.length > 0) {
                        diff.modifiedRows.push({
                            originalRow: originalRow.row,
                            modifiedRow: modifiedRow.row,
                            originalIndex: originalRow.index,
                            modifiedIndex: modifiedRow.index,
                            cellDiffs
                        });
                    } else {
                        diff.unchangedRows.push({ row: originalRow.row, index: originalRow.index });
                    }
                } else {
                    diff.unchangedRows.push({ row: originalRow.row, index: originalRow.index });
                }
            }
        });
        
        // 更新统计信息
        diff.summary.added = diff.addedRows.length;
        diff.summary.removed = diff.removedRows.length;
        diff.summary.modified = diff.modifiedRows.length;
        diff.summary.unchanged = diff.unchangedRows.length;
        
        return diff;
    }
}

// 字符级差异高亮算法
class CharacterDiff {
    static computeCharacterDiff(oldText, newText) {
        // 使用Google的diff-match-patch库进行字符级差异计算
        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(oldText, newText);
        dmp.diff_cleanupSemantic(diffs);
        return diffs;
    }
}

// 渲染字符级差异
function renderCharacterDiff(diffs, originalEl, modifiedEl) {
    originalEl.innerHTML = '';
    modifiedEl.innerHTML = '';

    diffs.forEach(function([type, text]) {
        if (type === -1) { // 删除
            const span = document.createElement('span');
            span.className = 'char-remove';
            span.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
            originalEl.appendChild(span);
            diffNavigator.addDiff('delete', text, span);
        } else if (type === 1) { // 插入
            const span = document.createElement('span');
            span.className = 'char-add';
            span.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
            modifiedEl.appendChild(span);
            diffNavigator.addDiff('insert', text, span);
        } else { // 相等
            const span = document.createElement('span');
            span.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
            originalEl.appendChild(span);
            modifiedEl.appendChild(span.cloneNode(true));
        }
    });
}

// 表格渲染和可视化
class TableRenderer {
    static renderTableDiff(diff, originalEl, modifiedEl) {
        originalEl.innerHTML = '';
        modifiedEl.innerHTML = '';
        
        // 创建摘要信息
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'table-summary';
        summaryDiv.innerHTML = `
            <div class="summary-item">原始: ${diff.summary.totalRows.original} 行</div>
            <div class="summary-item added">新增: ${diff.summary.added} 行</div>
            <div class="summary-item removed">删除: ${diff.summary.removed} 行</div>
            <div class="summary-item modified">修改: ${diff.summary.modified} 行</div>
            <div class="summary-item">未变: ${diff.summary.unchanged} 行</div>
        `;
        
        originalEl.appendChild(summaryDiv.cloneNode(true));
        modifiedEl.appendChild(summaryDiv);
        
        // 渲染原始表格
        this.renderTableWithDiff(diff, originalEl, 'original');
        this.renderTableWithDiff(diff, modifiedEl, 'modified');
    }
    
    static renderTableWithDiff(diff, container, type) {
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        
        const table = document.createElement('table');
        table.className = 'diff-table';
        
        // 获取所有可能的列名
        const allRows = [
            ...diff.removedRows.map(r => r.row),
            ...diff.addedRows.map(r => r.row),
            ...diff.modifiedRows.map(r => type === 'original' ? r.originalRow : r.modifiedRow),
            ...diff.unchangedRows.map(r => r.row)
        ];
        
        if (allRows.length === 0) {
            container.innerHTML += '<div style="text-align: center; color: #666; padding: 20px;">无数据</div>';
            return;
        }
        
        const columns = [...new Set(allRows.flatMap(row => Object.keys(row)))];
        
        // 创建表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const rowNumHeader = document.createElement('th');
        rowNumHeader.className = 'row-number';
        rowNumHeader.textContent = '#';
        headerRow.appendChild(rowNumHeader);
        
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 创建表体
        const tbody = document.createElement('tbody');
        let rowNumber = 1;
        
        // 按行号排序所有行
        const allData = [];
        
        // 添加删除的行（只在原始表格中显示）
        if (type === 'original') {
            diff.removedRows.forEach(item => {
                allData.push({ ...item, type: 'removed', displayRow: item.row });
            });
        }
        
        // 添加新增的行（只在修改表格中显示）
        if (type === 'modified') {
            diff.addedRows.forEach(item => {
                allData.push({ ...item, type: 'added', displayRow: item.row });
            });
        }
        
        // 添加修改的行
        diff.modifiedRows.forEach(item => {
            const displayRow = type === 'original' ? item.originalRow : item.modifiedRow;
            allData.push({ 
                ...item, 
                type: 'modified', 
                displayRow,
                originalIndex: item.originalIndex,
                modifiedIndex: item.modifiedIndex
            });
        });
        
        // 添加未改变的行
        diff.unchangedRows.forEach(item => {
            allData.push({ ...item, type: 'unchanged', displayRow: item.row });
        });
        
        // 按索引排序
        allData.sort((a, b) => {
            const indexA = type === 'original' ? (a.originalIndex ?? a.index) : (a.modifiedIndex ?? a.index);
            const indexB = type === 'original' ? (b.originalIndex ?? b.index) : (b.modifiedIndex ?? b.index);
            return indexA - indexB;
        });
        
        // 渲染行
        allData.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = `row-${item.type}`;
            
            // 行号
            const rowNumCell = document.createElement('td');
            rowNumCell.className = 'row-number';
            rowNumCell.textContent = rowNumber++;
            tr.appendChild(rowNumCell);
            
            // 数据单元格
            columns.forEach(col => {
                const td = document.createElement('td');
                const value = item.displayRow[col] || '';
                
                if (item.type === 'modified') {
                    // 检查该字段是否被修改
                    const cellDiff = item.cellDiffs?.find(cd => cd.field === col);
                    if (cellDiff) {
                        td.className = 'cell-modified';
                        if (type === 'original') {
                            td.innerHTML = `<span class="cell-removed">${escapeHtml(cellDiff.original)}</span>`;
                        } else {
                            td.innerHTML = `<span class="cell-added">${escapeHtml(cellDiff.modified)}</span>`;
                        }
                    } else {
                        td.textContent = value;
                    }
                } else {
                    td.textContent = value;
                }
                
                tr.appendChild(td);
            });
            
            tbody.appendChild(tr);
        });
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
    }
}

// 差异导航功能
class DiffNavigator {
    constructor() {
        this.diffs = [];
        this.currentIndex = -1;
        this.diffElements = [];
    }

    clear() {
        this.diffs = [];
        this.currentIndex = -1;
        this.diffElements = [];
        this.updateButtons();
    }

    addDiff(type, text, element) {
        if (text.trim()) {
            this.diffs.push({ type, text, element });
            this.diffElements.push(element);
        }
    }

    navigate(direction) {
        if (this.diffs.length === 0) return;

        // 清除之前的高亮
        this.diffElements.forEach(el => el.classList.remove('diff-highlight'));

        let newIndex;
        if (direction === 'next') {
            // 从当前位置往后找，如果已到末尾则从开头开始
            newIndex = this.currentIndex < this.diffs.length - 1 ? this.currentIndex + 1 : 0;
        } else {
            // 从当前位置往前找，如果已到开头则从末尾开始
            newIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.diffs.length - 1;
        }

        this.currentIndex = newIndex;

        // 高亮当前差异
        const currentDiff = this.diffs[this.currentIndex];
        currentDiff.element.classList.add('diff-highlight');
        
        // 强制重绘确保高亮可见
        currentDiff.element.style.display = 'inline-block';
        setTimeout(() => {
            currentDiff.element.style.display = '';
        }, 10);
        
        // 获取结果容器并滚动到差异位置
        const resultContainer = currentDiff.element.closest('.result-group');
        if (resultContainer) {
            const targetTop = currentDiff.element.offsetTop - resultContainer.offsetTop - 50;
            resultContainer.scrollTop = Math.max(0, targetTop);
            
            // 确保元素在视图中
            const rect = currentDiff.element.getBoundingClientRect();
            const containerRect = resultContainer.getBoundingClientRect();
            if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                currentDiff.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        this.updateButtons();
        this.updateInfo();
    }

    updateButtons() {
        const prevBtn = document.getElementById('prevDiff');
        const nextBtn = document.getElementById('nextDiff');
        const jumpBtn = document.getElementById('jumpButton');
        const jumpInput = document.getElementById('jumpToDiff');
        const diffList = document.getElementById('diffList');
        
        const hasDiffs = this.diffs.length > 0;
        prevBtn.disabled = !hasDiffs;
        nextBtn.disabled = !hasDiffs;
        jumpBtn.disabled = !hasDiffs;
        jumpInput.disabled = !hasDiffs;
        diffList.disabled = !hasDiffs;
    }

    updateInfo() {
        const info = document.getElementById('diffInfo');
        const diffList = document.getElementById('diffList');
        
        if (this.diffs.length === 0) {
            info.textContent = '';
            if (diffList) {
                diffList.value = '';
            }
        } else {
            info.textContent = `${this.currentIndex + 1}/${this.diffs.length}`;
            // 同步更新下拉框的选中状态
            if (diffList) {
                diffList.value = this.currentIndex;
            }
        }
    }

    jumpTo(index) {
        if (index < 0 || index >= this.diffs.length) return false;
        
        // 清除之前的高亮
        this.diffElements.forEach(el => el.classList.remove('diff-highlight'));
        
        this.currentIndex = index;
        
        // 高亮当前差异
        const currentDiff = this.diffs[this.currentIndex];
        currentDiff.element.classList.add('diff-highlight');
        
        // 滚动到差异位置
        const resultContainer = currentDiff.element.closest('.result-group');
        if (resultContainer) {
            currentDiff.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        this.updateButtons();
        this.updateInfo();
        return true;
    }

    updateDiffList() {
        const diffList = document.getElementById('diffList');
        diffList.innerHTML = '<option value="">选择差异位置...</option>';
        
        this.diffs.forEach((diff, index) => {
            const option = document.createElement('option');
            const preview = diff.text.trim().substring(0, 30);
            const typeText = diff.type === 'delete' ? '删除' : '插入';
            option.value = index;
            option.textContent = `${index + 1}. ${typeText}: ${preview}${diff.text.length > 30 ? '...' : ''}`;
            diffList.appendChild(option);
        });
    }
}

const diffNavigator = new DiffNavigator();

// 全局错误处理
window.addEventListener('error', function(e) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = '发生错误: ' + e.error.message;
        statusElement.className = 'status error';
    }
    console.error('全局错误:', e.error);
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM加载完成，开始初始化应用');
    const statusElement = document.getElementById('status');
    
    try {
        statusElement.textContent = '初始化中: 查找DOM元素...';
        const compareTextButton = document.getElementById('compareText');
        const compareTableButton = document.getElementById('compareTable');
        const originalInput = document.getElementById('original');
        const modifiedInput = document.getElementById('modified');
        const originalResult = document.getElementById('originalResult');
        const modifiedResult = document.getElementById('modifiedResult');
        const textOptions = document.getElementById('textOptions');
        const ignoreListNumbersCheckbox = document.getElementById('ignoreListNumbers');
        const listValidationPanel = document.getElementById('listValidationPanel');
        const originalTableInput = document.getElementById('originalTable');
        const modifiedTableInput = document.getElementById('modifiedTable');
        const originalTableResult = document.getElementById('originalTableResult');
        const modifiedTableResult = document.getElementById('modifiedTableResult');

        // 验证核心元素
        const requiredElements = [
            compareTextButton, compareTableButton, originalInput, modifiedInput, 
            originalResult, modifiedResult, textOptions, ignoreListNumbersCheckbox,
            listValidationPanel, originalTableInput, modifiedTableInput,
            originalTableResult, modifiedTableResult, statusElement
        ];
        const elementNames = [
            'compareText', 'compareTable', 'original', 'modified', 'originalResult', 
            'modifiedResult', 'textOptions', 'ignoreListNumbers', 'listValidationPanel',
            'originalTable', 'modifiedTable', 'originalTableResult', 'modifiedTableResult',
            'status'
        ];
        
        for (let i = 0; i < requiredElements.length; i++) {
            if (!requiredElements[i]) {
                throw new Error(`缺少必要DOM元素: #${elementNames[i]}`);
            }
        }

        // 检查diff_match_patch库
        if (typeof diff_match_patch === 'undefined') {
            throw new Error('diff_match_patch库未加载');
        }

        statusElement.textContent = '初始化完成';
        
        // 模式切换功能
        let currentMode = 'text';
        const modeRadios = document.querySelectorAll('input[name="mode"]');
        const textMode = document.getElementById('textMode');
        const tableMode = document.getElementById('tableMode');
        const textResults = document.getElementById('textResults');
        const tableResults = document.getElementById('tableResults');
        
        // 强制初始化模式显示
        function initModeDisplay() {
            const selectedMode = document.querySelector('input[name="mode"]:checked').value;
            if (selectedMode === 'text') {
                textMode.style.display = 'flex';
                textOptions.style.display = 'flex';
                tableMode.style.display = 'none';
                textResults.style.display = 'flex';
                tableResults.style.display = 'none';
                compareTextButton.style.display = 'inline-block';
                compareTableButton.style.display = 'none';
            } else {
                textMode.style.display = 'none';
                textOptions.style.display = 'none';
                tableMode.style.display = 'flex';
                textResults.style.display = 'none';
                tableResults.style.display = 'flex';
                compareTextButton.style.display = 'none';
                compareTableButton.style.display = 'inline-block';
            }
        }
        
        initModeDisplay();
        
        modeRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                currentMode = this.value;
                
                if (currentMode === 'text') {
                    textMode.style.display = 'flex';
                    textOptions.style.display = 'flex';
                    tableMode.style.display = 'none';
                    textResults.style.display = 'flex';
                    tableResults.style.display = 'none';
                    compareTextButton.style.display = 'inline-block';
                    compareTableButton.style.display = 'none';
                } else {
                    textMode.style.display = 'none';
                    textOptions.style.display = 'none';
                    tableMode.style.display = 'flex';
                    textResults.style.display = 'none';
                    tableResults.style.display = 'flex';
                    compareTextButton.style.display = 'none';
                    compareTableButton.style.display = 'inline-block';
                }
                
                // 清空结果和导航器
                diffNavigator.clear();
                originalResult.innerHTML = '';
                modifiedResult.innerHTML = '';
                originalTableResult.innerHTML = '';
                modifiedTableResult.innerHTML = '';
                clearListValidationPanel(listValidationPanel);
                statusElement.textContent = '就绪';
            });
        });

        // 绑定文本比较按钮事件
        compareTextButton.addEventListener('click', function() {
            statusElement.textContent = '按钮被点击，开始处理...';
            console.log('文本比较按钮点击事件触发');
            compareTextButton.disabled = true;

            try {
                const original = originalInput.value;
                const modified = modifiedInput.value;
                
                statusElement.textContent = '正在获取输入文本...';
                
                // 清空之前的结果和样式
                originalResult.innerHTML = '';
                modifiedResult.innerHTML = '';
                originalResult.classList.remove('error');
                modifiedResult.classList.remove('error');

                if (!original || !modified) {
                    clearListValidationPanel(listValidationPanel);
                    originalResult.textContent = '请输入要比较的文本';
                    modifiedResult.textContent = '两个文本框都不能为空';
                    originalResult.classList.add('error');
                    modifiedResult.classList.add('error');
                    return;
                }

                const originalAnalysis = ListNumberingAnalyzer.analyze(original, '原始文本');
                const modifiedAnalysis = ListNumberingAnalyzer.analyze(modified, '修改文本');
                const originalIssueMap = buildIssueMap(originalAnalysis);
                const modifiedIssueMap = buildIssueMap(modifiedAnalysis);
                originalAnalysis.lines.forEach(line => {
                    line.validationIssues = originalIssueMap.get(line.lineNumber) || [];
                });
                modifiedAnalysis.lines.forEach(line => {
                    line.validationIssues = modifiedIssueMap.get(line.lineNumber) || [];
                });
                renderListValidationPanel(listValidationPanel, originalAnalysis, modifiedAnalysis);

                let diffCount = 0;
                if (ignoreListNumbersCheckbox.checked) {
                    statusElement.textContent = '处理中: 按列表层级忽略序号差异...';
                    const comparison = NumberingAwareTextComparer.compare(originalAnalysis, modifiedAnalysis);
                    NumberingAwareTextComparer.renderComparison(comparison, originalResult, modifiedResult);
                    diffCount = diffNavigator.diffs.length;
                } else {
                    statusElement.textContent = '处理中: 使用Myers算法比较...';
                    const comparison = StandardTextComparer.compare(originalAnalysis, modifiedAnalysis);
                    comparison.operations.forEach(operation => {
                        if (operation.original) {
                            const originalMeta = originalAnalysis.lines[operation.original.lineNumber - 1];
                            if (originalMeta) {
                                Object.assign(operation.original, originalMeta);
                            }
                            operation.original.validationIssues = originalIssueMap.get(operation.original.lineNumber) || [];
                        }
                        if (operation.modified) {
                            const modifiedMeta = modifiedAnalysis.lines[operation.modified.lineNumber - 1];
                            if (modifiedMeta) {
                                Object.assign(operation.modified, modifiedMeta);
                            }
                            operation.modified.validationIssues = modifiedIssueMap.get(operation.modified.lineNumber) || [];
                        }
                    });
                    StandardTextComparer.renderComparison(comparison, originalResult, modifiedResult);
                    diffCount = diffNavigator.diffs.length;
                }

                diffNavigator.updateButtons();
                diffNavigator.updateInfo();
                diffNavigator.updateDiffList();
                document.getElementById('jumpToDiff').value = '';

                if (diffCount === 0) {
                    statusElement.textContent = '处理完成: 未发现差异';
                } else {
                    statusElement.textContent = `比较完成: 找到 ${diffCount} 处差异`;
                }
                console.log('比较完成');

            } catch (error) {
                console.error('比较过程出错:', error);
                statusElement.textContent = `错误: ${error.message}`;
                originalResult.textContent = '比较过程发生错误';
                modifiedResult.textContent = error.message;
                originalResult.classList.add('error');
                modifiedResult.classList.add('error');
            } finally {
                compareTextButton.disabled = false;
            }
        });

        // 绑定表格比较按钮事件
        compareTableButton.addEventListener('click', function() {
            statusElement.textContent = '按钮被点击，开始处理...';
            console.log('表格比较按钮点击事件触发');
            compareTableButton.disabled = true;

            try {
                const originalText = originalTableInput.value;
                const modifiedText = modifiedTableInput.value;
                
                statusElement.textContent = '正在获取输入表格数据...';
                
                // 清空之前的结果和样式
                originalTableResult.innerHTML = '';
                modifiedTableResult.innerHTML = '';
                originalTableResult.classList.remove('error');
                modifiedTableResult.classList.remove('error');
                clearListValidationPanel(listValidationPanel);

                if (!originalText || !modifiedText) {
                    originalTableResult.textContent = '请输入要比较的表格数据';
                    modifiedTableResult.textContent = '两个文本框都不能为空';
                    originalTableResult.classList.add('error');
                    modifiedTableResult.classList.add('error');
                    return;
                }

                // 解析表格数据
                statusElement.textContent = '正在解析表格数据...';
                const originalData = TableParser.parseTableData(originalText);
                const modifiedData = TableParser.parseTableData(modifiedText);

                if (originalData.length === 0 && modifiedData.length === 0) {
                    originalTableResult.textContent = '无法解析表格数据';
                    modifiedTableResult.textContent = '请检查输入格式是否正确';
                    originalTableResult.classList.add('error');
                    modifiedTableResult.classList.add('error');
                    return;
                }

                if (JSON.stringify(originalData) === JSON.stringify(modifiedData)) {
                    originalTableResult.textContent = '两个表格完全相同';
                    modifiedTableResult.textContent = '未检测到差异';
                    clearListValidationPanel(listValidationPanel);
                    statusElement.textContent = '处理完成: 未发现差异';
                    return;
                }

                statusElement.textContent = '正在计算表格差异...';
                const diff = TableDiff.computeTableDiff(originalData, modifiedData);
                
                // 清空导航器
                diffNavigator.clear();
                originalTableResult.innerHTML = '';
                modifiedTableResult.innerHTML = '';

                // 渲染表格差异
                TableRenderer.renderTableDiff(diff, originalTableResult, modifiedTableResult);
                clearListValidationPanel(listValidationPanel);
                
                // 更新导航按钮状态（表格模式暂不支持导航）
                diffNavigator.updateButtons();
                diffNavigator.updateInfo();
                
                const totalChanges = diff.summary.added + diff.summary.removed + diff.summary.modified;
                statusElement.textContent = `表格比较完成: 找到 ${totalChanges} 处差异`;
                console.log('表格比较完成');

            } catch (error) {
                console.error('表格比较过程出错:', error);
                statusElement.textContent = `错误: ${error.message}`;
                originalTableResult.textContent = '表格比较过程发生错误';
                modifiedTableResult.textContent = error.message;
                originalTableResult.classList.add('error');
                modifiedTableResult.classList.add('error');
            } finally {
                compareTableButton.disabled = false;
            }
        });

        // 监听导航按钮点击事件
        document.getElementById('prevDiff').addEventListener('click', function() {
            diffNavigator.navigate('prev');
        });

        document.getElementById('nextDiff').addEventListener('click', function() {
            diffNavigator.navigate('next');
        });

        // 监听跳转按钮和输入框事件
        document.getElementById('jumpButton').addEventListener('click', function() {
            const jumpInput = document.getElementById('jumpToDiff');
            const targetIndex = parseInt(jumpInput.value) - 1;
            
            if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= diffNavigator.diffs.length) {
                alert('请输入有效的差异编号 (1-' + diffNavigator.diffs.length + ')');
                return;
            }
            
            diffNavigator.jumpTo(targetIndex);
        });

        document.getElementById('jumpToDiff').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                document.getElementById('jumpButton').click();
            }
        });

        // 监听差异列表选择事件
        document.getElementById('diffList').addEventListener('change', function() {
            const selectedIndex = parseInt(this.value);
            if (!isNaN(selectedIndex)) {
                diffNavigator.jumpTo(selectedIndex);
            }
        });

        // 同步滚动功能 - 基于字符位置的精确同步
        let isSyncing = false;
        let syncTimeout = null;
        
        function syncScroll(source, target) {
            if (isSyncing) return;
            
            clearTimeout(syncTimeout);
            syncTimeout = setTimeout(() => {
                isSyncing = true;
                
                const sourceContainer = source.closest('.result-group');
                const targetContainer = target.closest('.result-group');
                
                // 获取内容长度用于精确对应
                const sourceText = source.textContent || '';
                const targetText = target.textContent || '';
                
                // 计算当前滚动位置的字符比例
                const sourceCharPosition = getCharPositionFromScroll(sourceContainer, sourceText);
                const targetCharPosition = Math.min(sourceCharPosition, targetText.length);
                
                // 根据字符位置计算目标滚动位置
                const targetScrollTop = getScrollFromCharPosition(targetContainer, targetText, targetCharPosition);
                
                // 平滑滚动到对应位置
                targetContainer.scrollTop = targetScrollTop;
                
                setTimeout(() => {
                    isSyncing = false;
                }, 100);
            }, 50);
        }
        
        function getCharPositionFromScroll(container, text) {
            if (!text) return 0;
            
            const scrollRatio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
            return Math.floor(text.length * scrollRatio);
        }
        
        function getScrollFromCharPosition(container, text, charPosition) {
            if (!text) return 0;
            
            const charRatio = charPosition / Math.max(1, text.length);
            return charRatio * Math.max(1, container.scrollHeight - container.clientHeight);
        }
        
        // 添加滚动监听 - 基于字符位置的精确同步
        originalResult.closest('.result-group').addEventListener('scroll', function() {
            if (!isSyncing) {
                syncScroll(this, modifiedResult);
            }
        }, { passive: true });
        
        modifiedResult.closest('.result-group').addEventListener('scroll', function() {
            if (!isSyncing) {
                syncScroll(this, originalResult);
            }
        }, { passive: true });

        // 历史记录管理
        class HistoryManager {
            constructor() {
                this.storageKey = 'textComparisonHistory';
                this.maxHistory = 50;
                this.history = this.loadHistory();
            }

            loadHistory() {
                try {
                    const saved = localStorage.getItem(this.storageKey);
                    return saved ? JSON.parse(saved) : [];
                } catch (error) {
                    console.error('加载历史记录失败:', error);
                    return [];
                }
            }

            saveHistory() {
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(this.history));
                } catch (error) {
                    console.error('保存历史记录失败:', error);
                }
            }

            addRecord(original, modified, result1, result2, diffCount) {
                const record = {
                    id: Date.now(),
                    timestamp: new Date().toLocaleString('zh-CN'),
                    original: original,
                    modified: modified,
                    originalPreview: original.trim().substring(0, 100) + (original.trim().length > 100 ? '...' : ''),
                    modifiedPreview: modified.trim().substring(0, 100) + (modified.trim().length > 100 ? '...' : ''),
                    diffCount: diffCount,
                    originalLength: original.length,
                    modifiedLength: modified.length
                };

                this.history.unshift(record);
                
                // 限制历史记录数量
                if (this.history.length > this.maxHistory) {
                    this.history = this.history.slice(0, this.maxHistory);
                }

                this.saveHistory();
                this.updateHistoryCount();
            }

            deleteRecord(id) {
                this.history = this.history.filter(record => record.id !== id);
                this.saveHistory();
                this.displayHistory();
                this.updateHistoryCount();
            }

            clearHistory() {
                if (confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
                    this.history = [];
                    this.saveHistory();
                    this.displayHistory();
                    this.updateHistoryCount();
                }
            }

            displayHistory() {
                const historyPanel = document.getElementById('historyPanel');
                const historyList = document.getElementById('historyList');
                
                if (this.history.length === 0) {
                    historyList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">暂无历史记录</div>';
                    return;
                }

                historyList.innerHTML = '';
                this.history.forEach(record => {
                    const item = document.createElement('div');
                    item.className = 'history-item';
                    item.innerHTML = `
                        <div class="history-header-row">
                            <div class="history-time">${record.timestamp} - 差异数: ${record.diffCount}</div>
                            <div class="history-actions">
                                <button class="history-btn load-btn" data-action="loadOriginal" data-id="${record.id}">加载原文</button>
                                <button class="history-btn load-btn" data-action="loadModified" data-id="${record.id}">加载修改</button>
                                <button class="history-btn load-btn" data-action="loadRecord" data-id="${record.id}">全部加载</button>
                                <button class="history-btn delete-btn" data-action="deleteRecord" data-id="${record.id}">删除</button>
                            </div>
                        </div>
                        <div class="history-preview">
                            <div class="history-text">
                                <strong>原文:</strong>${escapeHtml(record.originalPreview)}
                                <br><small>长度: ${record.originalLength}字符</small>
                            </div>
                            <div class="history-text">
                                <strong>修改:</strong>${escapeHtml(record.modifiedPreview)}
                                <br><small>长度: ${record.modifiedLength}字符</small>
                            </div>
                        </div>
                    `;
                    historyList.appendChild(item);
                });
                
                // 使用事件委托处理按钮点击
                historyList.addEventListener('click', (e) => {
                    if (e.target.classList.contains('history-btn')) {
                        const action = e.target.getAttribute('data-action');
                        const id = parseInt(e.target.getAttribute('data-id'));
                        
                        if (action && id) {
                            switch (action) {
                                case 'loadOriginal':
                                    this.loadOriginal(id);
                                    break;
                                case 'loadModified':
                                    this.loadModified(id);
                                    break;
                                case 'loadRecord':
                                    this.loadRecord(id);
                                    break;
                                case 'deleteRecord':
                                    this.deleteRecord(id);
                                    break;
                            }
                        }
                    }
                });

                historyPanel.style.display = 'block';
                this.createOverlay();
            }

            loadRecord(id) {
                try {
                    console.log('尝试加载记录:', id);
                    const record = this.history.find(r => r.id === id);
                    if (record) {
                        console.log('找到记录:', record);
                        document.getElementById('original').value = record.original;
                        document.getElementById('modified').value = record.modified;
                        document.getElementById('compare').click();
                        this.closeHistory();
                    } else {
                        console.error('未找到记录:', id);
                        alert('未找到指定的历史记录');
                    }
                } catch (error) {
                    console.error('加载记录失败:', error);
                    alert('加载记录失败: ' + error.message);
                }
            }

            loadOriginal(id) {
                try {
                    console.log('尝试加载原文:', id);
                    const record = this.history.find(r => r.id === id);
                    if (record) {
                        console.log('找到记录:', record);
                        document.getElementById('original').value = record.original;
                        this.closeHistory();
                        // 如果修改文本已存在，自动触发对比
                        const modified = document.getElementById('modified').value;
                        if (modified) {
                            document.getElementById('compare').click();
                        }
                    } else {
                        console.error('未找到记录:', id);
                        alert('未找到指定的历史记录');
                    }
                } catch (error) {
                    console.error('加载原文失败:', error);
                    alert('加载原文失败: ' + error.message);
                }
            }

            loadModified(id) {
                try {
                    console.log('尝试加载修改:', id);
                    const record = this.history.find(r => r.id === id);
                    if (record) {
                        console.log('找到记录:', record);
                        document.getElementById('modified').value = record.modified;
                        this.closeHistory();
                        // 如果原始文本已存在，自动触发对比
                        const original = document.getElementById('original').value;
                        if (original) {
                            document.getElementById('compare').click();
                        }
                    } else {
                        console.error('未找到记录:', id);
                        alert('未找到指定的历史记录');
                    }
                } catch (error) {
                    console.error('加载修改失败:', error);
                    alert('加载修改失败: ' + error.message);
                }
            }

            closeHistory() {
                document.getElementById('historyPanel').style.display = 'none';
                this.removeOverlay();
            }

            createOverlay() {
                const overlay = document.createElement('div');
                overlay.className = 'overlay';
                overlay.onclick = () => this.closeHistory();
                document.body.appendChild(overlay);
            }

            removeOverlay() {
                const overlay = document.querySelector('.overlay');
                if (overlay) overlay.remove();
            }

            updateHistoryCount() {
                const showHistoryBtn = document.getElementById('showHistory');
                const count = this.history.length;
                showHistoryBtn.textContent = count > 0 ? `历史记录 (${count})` : '历史记录';
            }
        }

        // 初始化历史记录管理器
        const historyManager = new HistoryManager();
        window.historyManager = historyManager; // 确保全局可访问
        historyManager.updateHistoryCount();
        
        // 添加全局错误处理，防止 window.historyManager 未定义
        window.addEventListener('error', function(e) {
            if (e.message && e.message.includes('Cannot read properties of undefined')) {
                console.error('检测到 historyManager 未定义错误:', e);
                // 尝试重新初始化
                if (!window.historyManager) {
                    console.log('尝试重新初始化 historyManager...');
                    window.historyManager = new HistoryManager();
                    window.historyManager.updateHistoryCount();
                }
            }
        });

        // 绑定历史记录按钮事件
        document.getElementById('saveHistory').addEventListener('click', function() {
            const original = document.getElementById('original').value;
            const modified = document.getElementById('modified').value;
            const diffCount = diffNavigator.diffs.length;
            
            if (!original || !modified) {
                alert('请先输入要比较的文本');
                return;
            }

            window.historyManager.addRecord(original, modified, 
                document.getElementById('originalResult').innerHTML, 
                document.getElementById('modifiedResult').innerHTML, 
                diffCount);
            
            alert('历史记录已保存！');
        });

        document.getElementById('showHistory').addEventListener('click', function() {
            window.historyManager.displayHistory();
        });

        document.getElementById('closeHistory').addEventListener('click', function() {
            window.historyManager.closeHistory();
        });

        document.getElementById('clearHistory').addEventListener('click', function() {
            window.historyManager.clearHistory();
        });

        // 键盘快捷键
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                window.historyManager.closeHistory();
            }
        });

    } catch (error) {
        console.error('初始化失败:', error);
        statusElement.textContent = `初始化失败: ${error.message}`;
        statusElement.className = 'status error';
    }
});

// 主题切换功能
class ThemeManager {
    constructor() {
        this.themeSelect = document.getElementById('themeSelect');
        this.init();
    }

    init() {
        // 从localStorage加载保存的主题
        const savedTheme = localStorage.getItem('selectedTheme') || 'classic';
        this.setTheme(savedTheme);
        this.themeSelect.value = savedTheme;

        // 绑定主题切换事件
        this.themeSelect.addEventListener('change', (e) => {
            const selectedTheme = e.target.value;
            this.setTheme(selectedTheme);
            localStorage.setItem('selectedTheme', selectedTheme);
        });
    }

    setTheme(themeName) {
        // 移除所有主题类
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        
        // 添加选中的主题类
        if (themeName !== 'classic') {
            document.body.classList.add(`theme-${themeName}`);
        }

        // 更新主题选择器显示
        if (this.themeSelect) {
            this.themeSelect.value = themeName;
        }

        console.log(`已切换到主题: ${themeName}`);
    }

    // 获取当前主题
    getCurrentTheme() {
        return this.themeSelect ? this.themeSelect.value : 'classic';
    }
}

// 初始化主题管理器
document.addEventListener('DOMContentLoaded', function() {
    window.themeManager = new ThemeManager();
});

import React from 'react';

/**
 * Renders a translated string whose {tokens} are replaced by React nodes
 * (e.g. a highlighted rank or name), so word order can differ per language.
 *
 *   <Text>{rich(t('action.wants', { name }), { rank: <Text style={hl}>K</Text> })}</Text>
 *
 * Returns an array of strings/nodes to put inside a parent <Text>.
 */
export function rich(str, nodes) {
  const parts = String(str).split(/\{(\w+)\}/);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part; // plain text
    const node = nodes[part];
    if (node === undefined) return `{${part}}`;
    return React.isValidElement(node) ? React.cloneElement(node, { key: `${part}-${i}` }) : node;
  });
}

import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from './button'

const cls = (props: object) => renderToStaticMarkup(createElement(Button, props)).match(/class="([^"]*)"/)![1].split(' ')

test('icon sizes are square boxes without w-fit (cn has no merge, w-fit would beat size-*)', () => {
  expect(cls({ size: 'icon', icon: 'arrow-up' })).not.toContain('w-fit')
  expect(cls({ size: 'icon', icon: 'arrow-up' })).toContain('size-10')
  expect(cls({ size: 'icon-lg', icon: 'cog' })).not.toContain('w-fit')
  expect(cls({ size: 'icon-lg', icon: 'cog' })).toContain('size-[52px]')
  expect(cls({ size: 'md' })).toContain('w-fit')
  expect(cls({ variant: 'link' })).toContain('w-fit')
})

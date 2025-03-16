const kebabCase = str => str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? "-" : "") + $.toLowerCase())
const camelCase = str => str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const config = {
    hostSuffix: 'element',
    proxySuffix: 'proxy',
    refSuffix: 'ref',
}

class PropSyncer {
    props = {}
    keys = {}
    constructor(props = {}) {
        this.props = props
        for (const key in this.props) {
            const attr = kebabCase(key)
            this.keys[key] = attr
            this.keys[attr] = key
        }
    }

    write(defaultVal, val) {
        if (typeof defaultVal == 'string') return val
        if (typeof defaultVal == 'boolean') return val ? '' : 'false'
        try { return JSON.stringify(val) } catch { return val }
    }
    read(defaultVal, val) {
        if (typeof defaultVal == 'string') return val
        if (typeof defaultVal == 'boolean') return val !== '0' && val !== 'false'
        try { return JSON.parse(val) } catch { return val }
    }

    init(object, element) {
        const attrProps = JSON.parse(element.getAttribute('data-props') || '{}')
        for (const key in this.props) {
            const attr = this.keys[key]
            const defaultVal = this.props[key]
            if (element.hasAttribute(attr)) {
                this.set(object, element, key, this.read(defaultVal, element.getAttribute(attr)), false)
            } else if (key in attrProps) {
                this.set(object, element, key, attrProps[key], true)
            } else {
                this.set(object, element, key, defaultVal, false)
            }
        }
        element.removeAttribute('data-props')
    }

    set(object, element, key, val, sync = true) {
        if (val === object[`#${key}`]) return
        const oldVal = object[`#${key}`]
        object[`#${key}`] = val
        if (typeof object[`${key}Changed`] === 'function') {
            object[`${key}Changed`](oldVal, val)
        }
        if (!sync) return
        const defaultVal = this.props[key]
        const writeVal = this.write(defaultVal, val)
        const writeName = this.keys[key]
        if (
           typeof defaultVal === 'object'
           && writeVal === this.write(defaultVal, defaultVal)
        ) {
            element.removeAttribute(writeName)
            return
        }
        if (val === defaultVal) {
            element.removeAttribute(writeName)
            return
        }
        element.setAttribute(writeName, writeVal)
    }

    attributeChanged(object, element, name, oldVal, newVal) {
        if (name === 'data-props') {
            this.init(object, element)
            return
        }
        const key = this.keys[name]
        let newReadVal
        const defaultVal = this.props[key]
        if (newVal === null || newVal === undefined) {
            newReadVal = defaultVal
        } else {
            newReadVal = this.read(defaultVal, newVal)
        }
        this.set(object, element, key, newReadVal, false)
    }
}


const refsOrphanMap = new Map()

class ProxyRefElement extends HTMLElement {
    static observedAttributes = ['as', 'proxy', 'for']
    get as() {
        return this.getAttribute('as')
    }
    get token() {
        return this.getAttribute('proxy')
    }
    get for() {
        return this.getAttribute('for')
    }
    get target() {
        return this.parentElement
    }
    host = null
    proxy = null
    connectedCallback() {
        window.requestAnimationFrame(() => {
            this.host = this.for ? document.getElementById(this.for) : this.closest('[data-scope]')
            this.proxy = this.host?.tagName == `${this.for}-${config.hostSuffix}`.toUpperCase() ? this.host : this.host?.querySelector(`:scope > ${this.token}-${config.proxySuffix}`)
            if (!this.proxy || this.proxy.target !== this.host) {
                if (this.for) {
                    if (!refsOrphanMap.has(this.for)) {
                        refsOrphanMap.set(this.for, new Set())
                    }
                    refsOrphanMap.get(this.for).add(this)
                    return
                }
                if (!refsOrphanMap.has('')) {
                    refsOrphanMap.set('', new Set())
                }
                refsOrphanMap.get('').add(this)
                return
            }
            const camelCasedAs = camelCase(this.as)
            if (this.proxy[`${camelCasedAs}ConnectedCallback`]) {
                this.proxy[`${camelCasedAs}ConnectedCallback`](this.target)
            }
            this.proxy[`${camelCasedAs}Refs`].add(this.target)
        })
    }
    disconnectedCallback() {
        window.requestAnimationFrame(() => {
            if (!this.proxy) {
                return
            }
            const camelCasedAs = camelCase(this.as)
            if (this.proxy[`${camelCasedAs}DisconnectedCallback`]) {
                this.proxy[`${camelCasedAs}DisconnectedCallback`](this.target)
            }
            this.proxy[`${camelCasedAs}Refs`].delete(this.target)
        })
    }
    attributeChangedCallback(name, oldVal, newVal) {
        if (['as', 'proxy', 'for'].includes(name)) {
            this.disconnectedCallback()
            this.connectedCallback()
        }
    }
}

class ProxyElement extends HTMLElement {
    static props = {}
    static refs = []
    static observedAttributes = []
    static token = ''
    get target() {
        return this.parentElement
    }
    get token() {
        return this.constructor.token
    }
    constructor() {
        super()
        this.constructor.__propSync.init(this, this)
        this.initializedCallback()
    }
    initializedCallback() {}
    attributeChangedCallback(name, oldVal, newVal) {
        this.constructor.__propSync.attributeChanged(this, this, name, oldVal, newVal)
    }
    connectedCallback() {
        const scope = this.target.getAttribute('data-scope') || ''
        this.target.setAttribute('data-scope', `${scope} ${this.token} `)
        if (this.target.id && refsOrphanMap.has(this.target.id)) {
            const orphans = refsOrphanMap.get(this.target.id)
            refsOrphanMap.delete(this.target.id)
            for (const orphan of orphans) {
                orphan.connectedCallback()
            }
        }
        for (const orphan of refsOrphanMap.get('') ?? []) {
            if (this.target.contains(orphan)) {
                refsOrphanMap.get('').delete(orphan)
                orphan.connectedCallback()
            }
        }
    }
    disconnectedCallback() {
        const scope = this.target.getAttribute('data-scope') || ''
        this.target.setAttribute('data-scope', scope.replace(` ${this.token} `, ''))
    }
    dispatch(type, {
        target = this.target,
        prefix = this.token,
        detail = {},
        bubbles = false,
        cancelable = false,
        composed = false
    } = {}) {
        const fullType = prefix ? `${prefix}:${type}` : type
        const event = new CustomEvent(fullType, { detail, bubbles, cancelable, composed })
        target.dispatchEvent(event)
        return event
    }
}

const processProxyClass = (proxyClass, token) => {
    proxyClass.token = token
    proxyClass.__propSync = new PropSyncer(proxyClass.props)
    for (const key of Object.keys(proxyClass.props)) {
        proxyClass.observedAttributes.push(proxyClass.__propSync.keys[key])
        Object.defineProperty(proxyClass.prototype, key, {
            get() {
                return this[`#${key}`]
            },
            set(val) {
                proxyClass.__propSync.set(this, this, key, val, true)
            }
        })
    }
    for (const refToken of proxyClass.refs) {
        const camelCasedToken = camelCase(refToken)
        proxyClass.prototype[`${camelCasedToken}Refs`] = new Set()
        Object.defineProperty(proxyClass.prototype, `${camelCasedToken}Ref`, {
            get() {
                return this[`${camelCasedToken}Refs`].values()?.next()?.value
            },
        })
    }
}
const registerElements = (token, proxyClass) => {
    processProxyClass(proxyClass, token)
    customElements.define(`${token}-${config.proxySuffix}`, proxyClass)
    const hostClass = class extends proxyClass {
        get target() {
            return this
        }
    }
    customElements.define(`${token}-${config.hostSuffix}`, hostClass)
    const proxyRefClass = class extends ProxyRefElement {
        get token() {
            return token
        }
    }
    customElements.define(`${token}-${config.refSuffix}`, proxyRefClass)
}

customElements.define('proxy-ref', ProxyRefElement)

export { ProxyElement, PropSyncer, registerElements }
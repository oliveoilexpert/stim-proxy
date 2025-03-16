const kebabCase = str => str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? "-" : "") + $.toLowerCase())
const camelCase = str => str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const config = {
    hostTagSuffix: 'element',
    proxyTagSuffix: 'proxy',
    refTagSuffix: 'ref',
}

class PropSyncer {
    props = {}
    keyMap = {}
    constructor(props = {}) {
        this.props = props
        Object.keys(this.props).forEach(key => {
            const attr = kebabCase(key)
            this.keyMap[key] = attr
            this.keyMap[attr] = key
        })
    }

    write(key, val) {
        if (typeof this.props[key] == 'string') return val
        if (typeof this.props[key] == 'boolean') return val ? '' : 'false'
        try { return JSON.stringify(val) } catch { return val }
    }
    read(key, val) {
        if (typeof this.props[key] == 'string') return val
        if (typeof this.props[key] == 'boolean') return val !== '0' && val !== 'false'
        try { return JSON.parse(val) } catch { return val }
    }

    init(object, element, argAttributes = {}) {
        const attrAttributes = JSON.parse(element.getAttribute('data-props') || '{}')
        for (const key in this.props) {
            const attr = this.keyMap[key]
            if (element.hasAttribute(attr)) {
                this.set(object, element, key, this.read(key, element.getAttribute(attr)), false)
            } else if (Object.prototype.hasOwnProperty.call(attrAttributes, key)) {
                this.set(object, element, key, attrAttributes[key], true)
            } else if (Object.prototype.hasOwnProperty.call(argAttributes, key)) {
                this.set(object, element, key, argAttributes[key], true)
            } else {
                this.set(object, element, key, this.props[key], false)
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
        const writeVal = this.write(key, val)
        const writeName = this.keyMap[key]
        const defaultVal = this.props[key]
        if (
           typeof defaultVal === 'object'
           && writeVal === this.write(key, defaultVal)
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
        const key = this.keyMap[name]
        let newReadVal
        if (newVal === null || newVal === undefined) {
            newReadVal = this.props[key]
        } else {
            newReadVal = this.read(key, newVal)
        }
        this.set(object, element, key, newReadVal, false)
    }
}


const refsOrphanMap = new Map()

class ProxyRef extends HTMLElement {
    static observedAttributes = ['name', 'proxy', 'for']
    get token() {
        return this.getAttribute('name')
    }
    get proxyToken() {
        return this.getAttribute('proxy')
    }
    get hostId() {
        return this.getAttribute('for')
    }
    get target() {
        return this.parentElement
    }
    host = null
    proxy = null
    connectedCallback() {
        window.requestAnimationFrame(() => {
            this.host = this.hostId ? document.getElementById(this.hostId) : this.closest('[data-scope]')
            this.proxy = this.host?.tagName == `${this.for}-${config.hostTagSuffix}`.toUpperCase() ? this.host : this.host?.querySelector(`:scope > ${this.proxyToken}-${config.proxyTagSuffix}`)
            if (!this.proxy || this.proxy.target !== this.host) {
                if (this.hostId) {
                    if (!refsOrphanMap.has(this.hostId)) {
                        refsOrphanMap.set(this.hostId, new Set())
                    }
                    refsOrphanMap.get(this.hostId).add(this)
                    return
                }
                if (!refsOrphanMap.has('')) {
                    refsOrphanMap.set('', new Set())
                }
                refsOrphanMap.get('').add(this)
                return
            }
            if (this.proxy[`${camelCase(this.token)}ConnectedCallback`]) {
                this.proxy[`${camelCase(this.token)}ConnectedCallback`](this.target)
            }
            this.proxy[`${camelCase(this.token)}Refs`].add(this.target)
        })
    }
    disconnectedCallback() {
        window.requestAnimationFrame(() => {
            if (!this.proxy) {
                return
            }
            if (this.proxy[`${camelCase(this.token)}DisconnectedCallback`]) {
                this.proxy[`${camelCase(this.token)}DisconnectedCallback`](this.target)
            }
            this.proxy[`${camelCase(this.token)}Refs`].delete(this.target)
        })
    }
    attributeChangedCallback(name, oldVal, newVal) {
        if (['name', 'proxy', 'for'].includes(name)) {
            this.disconnectedCallback()
            this.connectedCallback()
        }
    }
}

class BehaviorProxy extends HTMLElement {
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

const processBehaviorProxyClass = (proxyClass, token) => {
    proxyClass.token = token
    proxyClass.__propSync = new PropSyncer(proxyClass.props)
    for (const key of Object.keys(proxyClass.props)) {
        proxyClass.observedAttributes.push(proxyClass.__propSync.keyMap[key])
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
const registerBehavior = (token, proxyClass) => {
    processBehaviorProxyClass(proxyClass, token)
    customElements.define(`${token}-${config.proxyTagSuffix}`, proxyClass)
    const hostClass = class extends proxyClass {
        get target() {
            return this
        }
    }
    customElements.define(`${token}-${config.hostTagSuffix}`, hostClass)
    proxyClass.refs.forEach(refToken => {
        const proxyRefClass = class extends ProxyRef {
            get token() {
                return refToken
            }
            get proxyToken() {
                return token
            }
        }
        customElements.define(`${token}-${refToken}-${config.refTagSuffix}`, proxyRefClass)
    })
}

customElements.define('proxy-ref', ProxyRef)

export { BehaviorProxy, registerBehavior }
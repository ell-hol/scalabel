import createStyles from '@material-ui/core/styles/createStyles'
import { withStyles } from '@material-ui/core/styles/index'
import * as React from 'react'
import * as THREE from 'three'
import Session from '../common/session'
import { getCurrentImageViewerConfig, getCurrentPointCloudViewerConfig, isItemLoaded } from '../functional/state_util'
import { PointCloudViewerConfigType, State } from '../functional/types'
import { MAX_SCALE, MIN_SCALE, updateCanvasScale } from '../view/image'
import { updateThreeCameraAndRenderer } from '../view/point_cloud'
import { Viewer } from './viewer'

const styles = () => createStyles({
  point_cloud_canvas: {
    position: 'absolute',
    height: '100%',
    width: '100%'
  }
})

interface ClassType {
  /** CSS canvas name */
  point_cloud_canvas: string
}

interface Props {
  /** CSS class */
  classes: ClassType
  /** container */
  display: HTMLDivElement | null
}

/**
 * Canvas Viewer
 */
class PointCloudViewer extends Viewer<Props> {
  /** Container */
  private display: HTMLDivElement | null
  /** Canvas to draw on */
  private canvas: HTMLCanvasElement | null
  /** Current scale */
  private scale: number
  /** ThreeJS Renderer */
  private renderer?: THREE.WebGLRenderer
  /** ThreeJS Scene object */
  private scene: THREE.Scene
  /** ThreeJS Camera */
  private camera: THREE.PerspectiveCamera
  /** ThreeJS sphere mesh for indicating camera target location */
  private target: THREE.Mesh
  /** Current point cloud for rendering */
  private pointCloud: THREE.Points | null

  /**
   * Constructor, ons subscription to store
   * @param {Object} props: react props
   */
  constructor (props: Readonly<Props>) {
    super(props)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    this.target = new THREE.Mesh(
      new THREE.SphereGeometry(0.03),
        new THREE.MeshBasicMaterial({
          color:
            0xffffff
        }))
    this.scene.add(this.target)

    this.pointCloud = null

    this.canvas = null
    this.display = null
    this.scale = 1
  }

  /**
   * Render function
   * @return {React.Fragment} React fragment
   */
  public render () {
    const { classes } = this.props

    let canvas = (
      <canvas
        key='point-cloud-canvas'
        className={classes.point_cloud_canvas}
        ref={(ref) => { this.initializeRefs(ref) }}
      />
    )

    if (this.display) {
      const displayRect = this.display.getBoundingClientRect()
      canvas = React.cloneElement(
        canvas,
        { height: displayRect.height, width: displayRect.width }
      )
    }

    return canvas
  }

  /**
   * Handles canvas redraw
   * @return {boolean}
   */
  public redraw (): boolean {
    const state = this.state.session
    const item = state.user.select.item
    console.log('item', item)
    const loaded = state.session.items[item].loaded
    if (loaded) {
      if (this.canvas) {
        this.updateRenderer()
        this.pointCloud = Session.pointClouds[item]
        this.renderThree()
      }
    }
    return true
  }

  /**
   * Override method
   * @param _state
   */
  protected updateState (_state: State) {
    this.display = this.props.display
  }

  /**
   * Render ThreeJS Scene
   */
  private renderThree () {
    if (this.renderer && this.pointCloud) {
      this.scene.children = []
      this.scene.add(this.pointCloud)
      this.renderer.render(this.scene, this.camera)
    }
  }
  /**
   * Set references to div elements and try to initialize renderer
   * @param {HTMLDivElement} component
   * @param {string} componentType
   */
  private initializeRefs (component: HTMLCanvasElement | null) {
    if (!component) {
      return
    }

    if (component.nodeName === 'CANVAS') {
      if (this.canvas && this.display) {
        if (Session.itemType === 'image') {
          const config = getCurrentImageViewerConfig(this.state.session)

          if (config.viewScale < MIN_SCALE || config.viewScale >= MAX_SCALE) {
            return
          }
          const newParams =
            updateCanvasScale(
              this.state.session,
              this.display,
              component,
              null,
              config,
              config.viewScale / this.scale,
              false
            )
          this.scale = newParams[3]
        }
      }

      if (this.canvas !== component) {
        this.canvas = component
        const rendererParams = { canvas: this.canvas, alpha: true }
        this.renderer = new THREE.WebGLRenderer(rendererParams)
      }

      if (isItemLoaded(this.state.session)) {
        this.updateRenderer()
      }
    }
  }

  /**
   * Update rendering constants
   */
  private updateRenderer () {
    if (this.canvas && this.renderer) {
      const config: PointCloudViewerConfigType = this.getCurrentViewerConfig()
      updateThreeCameraAndRenderer(
        this.canvas,
        config,
        this.renderer,
        this.camera,
        this.target
      )
    }
  }

  /**
   * Get point cloud view config
   */
  private getCurrentViewerConfig (): PointCloudViewerConfigType {
    return (getCurrentPointCloudViewerConfig(this.state.session))
  }
}

export default withStyles(styles, { withTheme: true })(PointCloudViewer)
